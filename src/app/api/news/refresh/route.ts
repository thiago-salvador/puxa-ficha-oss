import type { NextRequest } from "next/server"
import { after, NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { createServiceRoleSupabaseClient } from "@/lib/supabase"
import { secretsMatch } from "@/lib/crypto-utils"
import {
  defaultNewsRefreshDeps,
  refreshCandidatosNews,
  type NewsCandidato,
  type NewsRefreshSummary,
  type NoticiaRow,
} from "@/lib/news/refresh"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Cada invocacao processa um lote pequeno e se reencadeia via after(); 60s e o
// teto do plano e cobre o pior caso do lote (DEFAULT_BATCH_LIMIT * timeout) com
// folga.
export const maxDuration = 60

// Lote pequeno de proposito: ~DEFAULT_BATCH_LIMIT candidatos por invocacao, em
// serie com pausa, fica bem abaixo de maxDuration mesmo no pior caso (timeout
// por candidato). O resto e coberto pelo auto-encadeamento.
const DEFAULT_BATCH_LIMIT = 5
const MAX_BATCH_LIMIT = 6
const MAX_CHAIN_DEPTH = 40
// Tag de unstable_cache da ficha do candidato (onde a noticia e renderizada via
// /api/candidato-profile). O cron diario NAO deve derrubar a tag global por
// padrao: isso força recomputacao em massa das fichas e pode gerar burst de IO.
// Revalidacao global fica restrita a execucao manual explicita.
const FICHA_CACHE_TAG = "public-candidato-ficha"

type AfterResponseCallback = () => Promise<void> | void

interface NewsRefreshHandlerDeps {
  fetchCandidatoPage: (args: { cursor: number; limit: number }) => Promise<{
    candidatos: NewsCandidato[]
    total: number
  }>
  refreshNews: (candidatos: NewsCandidato[]) => Promise<NewsRefreshSummary>
  revalidate: (tag: string) => void
  afterResponse: (callback: AfterResponseCallback) => void
  fetchImpl: typeof fetch
  log: (event: string, detail: Record<string, unknown>) => void
}

function getCronSecret(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization")?.trim()
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim()
  }
  return null
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

async function defaultFetchCandidatoPage(args: { cursor: number; limit: number }) {
  const supabase = createServiceRoleSupabaseClient({ cacheMode: "no-store" })
  const { data, error, count } = await supabase
    .from("candidatos_publico")
    .select("id, slug, nome_urna, cargo_disputado", { count: "exact" })
    .order("slug", { ascending: true })
    .range(args.cursor, args.cursor + args.limit - 1)

  if (error) {
    throw new Error(`candidatos_publico query failed: ${error.message}`)
  }

  return {
    candidatos: (data ?? []) as NewsCandidato[],
    total: count ?? 0,
  }
}

function defaultRefreshNews(candidatos: NewsCandidato[]): Promise<NewsRefreshSummary> {
  const supabase = createServiceRoleSupabaseClient({ cacheMode: "no-store" })
  const upsertNoticias = async (rows: NoticiaRow[]) => {
    const { error } = await supabase
      .from("noticias_candidato")
      .upsert(rows, { onConflict: "candidato_id,url", ignoreDuplicates: true })
    return { error: error?.message ?? null }
  }
  return refreshCandidatosNews(candidatos, defaultNewsRefreshDeps(upsertNoticias))
}

const defaultDeps: NewsRefreshHandlerDeps = {
  fetchCandidatoPage: defaultFetchCandidatoPage,
  refreshNews: defaultRefreshNews,
  revalidate: (tag: string) => revalidateTag(tag, "max"),
  afterResponse: after,
  fetchImpl: fetch,
  log: (event, detail) => console.log(`[news-refresh] ${event} ${JSON.stringify(detail)}`),
}

export function createNewsRefreshHandler(deps: NewsRefreshHandlerDeps = defaultDeps) {
  return async function handler(req: NextRequest) {
    const expectedSecret = process.env.CRON_SECRET?.trim()
    const providedSecret = getCronSecret(req)

    if (!secretsMatch(providedSecret, expectedSecret)) {
      deps.log("unauthorized", {})
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const cursor = parsePositiveInt(req.nextUrl.searchParams.get("cursor"), 0)
    const requestedLimit = parsePositiveInt(req.nextUrl.searchParams.get("limit"), DEFAULT_BATCH_LIMIT)
    const limit = Math.max(1, Math.min(MAX_BATCH_LIMIT, requestedLimit || DEFAULT_BATCH_LIMIT))
    const chainDepth = parsePositiveInt(req.nextUrl.searchParams.get("depth"), 0)
    const shouldChain = req.nextUrl.searchParams.get("chain") !== "0" && chainDepth < MAX_CHAIN_DEPTH
    const shouldRevalidateGlobalFichaCache = req.nextUrl.searchParams.get("revalidate") === "1"

    let page: { candidatos: NewsCandidato[]; total: number }
    try {
      page = await deps.fetchCandidatoPage({ cursor, limit })
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown"
      deps.log("candidato_page_failed", { cursor, limit, message })
      return NextResponse.json({ error: "Could not load candidates" }, { status: 503 })
    }

    const summary = await deps.refreshNews(page.candidatos)

    const nextCursor = cursor + page.candidatos.length
    const hasMore = page.candidatos.length > 0 && nextCursor < page.total

    if (hasMore && shouldChain) {
      const nextUrl = new URL(req.nextUrl.pathname, req.nextUrl.origin)
      nextUrl.searchParams.set("cursor", String(nextCursor))
      nextUrl.searchParams.set("limit", String(limit))
      nextUrl.searchParams.set("chain", "1")
      nextUrl.searchParams.set("depth", String(chainDepth + 1))
      if (shouldRevalidateGlobalFichaCache) {
        nextUrl.searchParams.set("revalidate", "1")
      }

      deps.afterResponse(async () => {
        try {
          await deps.fetchImpl(nextUrl.toString(), {
            method: "POST",
            headers: { Authorization: `Bearer ${expectedSecret}` },
            cache: "no-store",
          })
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 300) : "unknown"
          deps.log("chain_fetch_failed", { nextCursor, message })
        }
      })
    }

    // Execucao manual explicita: permite flush global quando o operador aceita o
    // custo. O cron padrao deixa o Data Cache expirar naturalmente (~1h), evitando
    // burst de recomputacao de todas as fichas logo apos o refresh de noticias.
    if (!hasMore && shouldRevalidateGlobalFichaCache) {
      deps.revalidate(FICHA_CACHE_TAG)
    }
    const revalidatedTag = !hasMore && shouldRevalidateGlobalFichaCache ? FICHA_CACHE_TAG : null

    deps.log("batch_complete", {
      cursor,
      limit,
      chainDepth,
      processed: summary.processed,
      withNews: summary.withNews,
      rowsUpserted: summary.rowsUpserted,
      errorCount: summary.errors.length,
      nextCursor: hasMore ? nextCursor : null,
      chainScheduled: hasMore && shouldChain,
      revalidated: revalidatedTag,
      revalidateRequested: shouldRevalidateGlobalFichaCache,
      total: page.total,
    })

    return NextResponse.json({
      ok: true,
      cursor,
      limit,
      chainDepth,
      processed: summary.processed,
      withNews: summary.withNews,
      rowsUpserted: summary.rowsUpserted,
      errors: summary.errors,
      nextCursor: hasMore ? nextCursor : null,
      chainScheduled: hasMore && shouldChain,
      revalidated: revalidatedTag,
      revalidateRequested: shouldRevalidateGlobalFichaCache,
      total: page.total,
    })
  }
}

const handler = createNewsRefreshHandler()

// Vercel Cron dispara via GET (injeta Authorization: Bearer <CRON_SECRET>). O
// auto-encadeamento e o disparo manual usam POST. Mesmo handler nos dois.
export const GET = handler
export const POST = handler
