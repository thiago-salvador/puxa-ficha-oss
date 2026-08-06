import type { NextRequest } from "next/server"
import { after, NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { createServiceRoleSupabaseClient } from "@/lib/supabase"
import { secretsMatch } from "@/lib/crypto-utils"
import { resolveChainOrigin, validarOrigemEncadeamento } from "@/lib/cron-chain-origin"
import {
  defaultNewsRefreshDeps,
  refreshCandidatosNews,
  type ColetaTentativaNews,
  type NewsCandidato,
  type NewsRefreshSummary,
  type NoticiaRow,
} from "@/lib/news/refresh"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// A invocacao processa QUANTAS paginas couberem no orcamento de tempo e so
// entao se reencadeia via after(). O desenho anterior (1 pagina de 5 por
// invocacao, 39 hops encadeados) esbarrava na protecao anti-recursao da
// Vercel: medido em producao em 2026-08-05, o 5o fetch encadeado volta
// HTTP 508 LOOP_DETECTED e o resto da fila morre em silencio. Menos hops e a
// unica correcao de causa: com ~4min de orcamento por invocacao, os 194
// publicaveis cabem em 2-3 invocacoes (1-2 hops), longe do teto da protecao.
// 300s exige plano Pro, que e o plano deste projeto (4 crons no vercel.json;
// Hobby para em 2).
export const maxDuration = 300

// Margem entre o orcamento e o maxDuration cobre o pior caso de UMA pagina
// (limit * timeout de 8s + pausas) mais o proprio fetch de encadeamento.
const INVOCATION_BUDGET_MS = 240_000
// Pausa entre paginas, na mesma cadencia da pausa entre candidatos do
// refresh, para nao martelar o Google News na fronteira de paginas.
const PAGE_PAUSE_MS = 1500

// Pagina pequena: granularidade do upsert e do log por candidato. O que cabe
// na invocacao e governado pelo orcamento acima, nao pelo tamanho da pagina.
const DEFAULT_BATCH_LIMIT = 5
const MAX_BATCH_LIMIT = 6
// Valvula de escape para crescimento do roster ou invocacao encurtada. NAO
// pode se aproximar do teto da protecao anti-recursao (~5 hops): se o chain
// chegar la, o 508 aparece em chain_fetch_failed e o dia termina truncado.
const MAX_CHAIN_DEPTH = 40
// Tag de unstable_cache da ficha do candidato (onde a noticia e renderizada via
// /api/candidato-profile). O cron diario NAO deve derrubar a tag global por
// padrao: isso força recomputacao em massa das fichas e pode gerar burst de IO.
// Revalidacao global fica restrita a execucao manual explicita.
const FICHA_CACHE_TAG = "public-candidato-ficha"

// O elo do chain e um unico fetch fire-and-forget: um flake de rede aqui
// derrubava, em silencio, todos os lotes restantes do dia (a resposta ja foi
// 200 e ninguem re-arma a fila). Uma retentativa curta cobre o flake sem
// mascarar falha estrutural: a segunda falha seguida vira chain_fetch_failed.
const CHAIN_FETCH_ATTEMPTS = 2
const CHAIN_FETCH_RETRY_DELAY_MS = 3000
// O proximo lote so precisa ACEITAR a invocacao, nao terminar o trabalho dele.
// 15s e folgado para o handshake e curto o bastante para sobrar orcamento para
// a segunda tentativa dentro da mesma invocacao.
const CHAIN_FETCH_TIMEOUT_MS = 15_000

type AfterResponseCallback = () => Promise<void> | void

interface NewsRefreshHandlerDeps {
  fetchCandidatoPage: (args: { cursor: number; limit: number }) => Promise<{
    candidatos: NewsCandidato[]
    total: number
  }>
  refreshNews: (candidatos: NewsCandidato[]) => Promise<NewsRefreshSummary>
  /**
   * Grava as tentativas do lote em `public.coleta_log` (fonte `google-news`).
   * Falha aqui nunca derruba o lote: o handler engole e loga `coleta_log_failed`.
   */
  registrarColetas: (tentativas: ColetaTentativaNews[]) => Promise<void>
  revalidate: (tag: string) => void
  afterResponse: (callback: AfterResponseCallback) => void
  fetchImpl: typeof fetch
  sleep: (ms: number) => Promise<void>
  log: (event: string, detail: Record<string, unknown>) => void
  /** Orçamento da invocação. Nos testes, 0 força uma página por invocação. */
  invocationBudgetMs: number
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
    // nome_completo entra so para o guard de relevancia de titulo
    // (src/lib/news/name-match.ts); nao e gravado em noticias_candidato.
    .select("id, slug, nome_urna, nome_completo, cargo_disputado", { count: "exact" })
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

/**
 * Grava as tentativas do lote em `public.coleta_log`, no mesmo contrato de
 * `scripts/lib/coleta-log.ts` (fonte `google-news`, escopo `candidato`). O
 * refresh da rota era a unica coleta do projeto sem rastro nenhum: o cron
 * rodava todo dia, cobria 5 de 194 candidatos (incidente de 2026-08-04) e a
 * tabela dizia "nunca verificado" para os 194, sem denunciar a diferenca.
 * `execucao` agrupa por dia, o que basta para reconstruir uma rodada do cron
 * encadeado (cada lote e uma invocacao serverless separada).
 */
async function defaultRegistrarColetas(tentativas: ColetaTentativaNews[]): Promise<void> {
  if (tentativas.length === 0) return
  const supabase = createServiceRoleSupabaseClient({ cacheMode: "no-store" })
  const ambiente = process.env.VERCEL ? "vercel" : "local"
  const execucao = `${ambiente}:news-refresh:${new Date().toISOString().slice(0, 10)}`
  const { error } = await supabase.from("coleta_log").insert(
    tentativas.map((t) => ({
      fonte: "google-news",
      escopo: "candidato",
      alvo: t.alvo,
      candidato_id: t.candidato_id,
      resultado: t.resultado,
      volume: t.volume,
      detalhe: t.detalhe,
      url: t.url,
      execucao,
      duracao_ms: t.duracao_ms,
    })),
  )
  if (error) {
    throw new Error(error.message)
  }
}

const defaultDeps: NewsRefreshHandlerDeps = {
  fetchCandidatoPage: defaultFetchCandidatoPage,
  refreshNews: defaultRefreshNews,
  registrarColetas: defaultRegistrarColetas,
  revalidate: (tag: string) => revalidateTag(tag, "max"),
  afterResponse: after,
  fetchImpl: fetch,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  log: (event, detail) => console.log(`[news-refresh] ${event} ${JSON.stringify(detail)}`),
  invocationBudgetMs: INVOCATION_BUDGET_MS,
}

export function createNewsRefreshHandler(deps: NewsRefreshHandlerDeps = defaultDeps) {
  return async function handler(req: NextRequest) {
    const inicio = Date.now()
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

    // Processa paginas ate esgotar o universo ou o orcamento da invocacao.
    // E o que mantem o numero de hops encadeados baixo o bastante para nunca
    // encostar na protecao anti-recursao da Vercel (508 no ~5o hop).
    const summary: NewsRefreshSummary = {
      processed: 0,
      withNews: 0,
      rowsUpserted: 0,
      discardedByName: 0,
      errors: [],
      coletas: [],
    }
    let coletaLogOk = true
    let cursorAtual = cursor
    let total = 0
    let paginas = 0

    for (;;) {
      let page: { candidatos: NewsCandidato[]; total: number }
      try {
        page = await deps.fetchCandidatoPage({ cursor: cursorAtual, limit })
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown"
        deps.log("candidato_page_failed", { cursor: cursorAtual, limit, message })
        if (paginas === 0) {
          return NextResponse.json({ error: "Could not load candidates" }, { status: 503 })
        }
        // Falha no meio da invocacao: o que ja foi processado esta gravado, e o
        // encadeamento abaixo retoma deste cursor em vez de perder a cauda.
        break
      }

      total = page.total
      if (page.candidatos.length === 0) break

      const pagina = await deps.refreshNews(page.candidatos)
      summary.processed += pagina.processed
      summary.withNews += pagina.withNews
      summary.rowsUpserted += pagina.rowsUpserted
      summary.discardedByName += pagina.discardedByName
      summary.errors.push(...pagina.errors)
      summary.coletas.push(...pagina.coletas)

      // Rastro de tentativa em coleta_log (regra do projeto: toda coleta, com
      // ou sem achado, deixa rastro), gravado por pagina para o progresso
      // persistir mesmo se a invocacao morrer no meio. Telemetria nunca
      // derruba o lote: falha aqui vira log e a resposta segue com
      // coletaLogOk=false.
      try {
        await deps.registrarColetas(pagina.coletas)
      } catch (error) {
        coletaLogOk = false
        const message = error instanceof Error ? error.message.slice(0, 300) : "unknown"
        deps.log("coleta_log_failed", {
          cursor: cursorAtual,
          linhas: pagina.coletas.length,
          message,
        })
      }

      paginas += 1
      cursorAtual += page.candidatos.length
      if (cursorAtual >= total) break
      if (Date.now() - inicio >= deps.invocationBudgetMs) break
      await deps.sleep(PAGE_PAUSE_MS)
    }

    const nextCursor = cursorAtual
    const hasMore = summary.processed > 0 && nextCursor < total

    // Origem canonica, nunca req.nextUrl.origin: em producao o cron chega pela
    // URL *.vercel.app atras do SSO e o fetch encadeado morre num 302 silencioso
    // (ver src/lib/cron-chain-origin.ts).
    const origemBruta = resolveChainOrigin(req)
    const origem = validarOrigemEncadeamento(origemBruta)
    if (hasMore && shouldChain && !origem.ok) {
      // Falhar alto: o encadeamento para, mas o motivo fica no log em vez de o
      // CRON_SECRET sair em claro.
      deps.log("chain_origin_rejected", { origem: origemBruta, motivo: origem.motivo, nextCursor })
    }

    if (hasMore && shouldChain && origem.ok) {
      const nextUrl = new URL(req.nextUrl.pathname, origem.origin)
      nextUrl.searchParams.set("cursor", String(nextCursor))
      nextUrl.searchParams.set("limit", String(limit))
      nextUrl.searchParams.set("chain", "1")
      nextUrl.searchParams.set("depth", String(chainDepth + 1))
      if (shouldRevalidateGlobalFichaCache) {
        nextUrl.searchParams.set("revalidate", "1")
      }

      deps.afterResponse(async () => {
        for (let attempt = 1; attempt <= CHAIN_FETCH_ATTEMPTS; attempt += 1) {
          const ultimaTentativa = attempt === CHAIN_FETCH_ATTEMPTS
          const eventoDeFalha = ultimaTentativa ? "chain_fetch_failed" : "chain_fetch_retry"
          // Prazo por tentativa. Sem ele, um POST interno que trava nunca
          // devolve: o loop nao tenta de novo, nao registra chain_fetch_failed
          // e os candidatos restantes ficam sem nova invocacao.
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), CHAIN_FETCH_TIMEOUT_MS)
          try {
            const res = await deps.fetchImpl(nextUrl.toString(), {
              method: "POST",
              headers: { Authorization: `Bearer ${expectedSecret}` },
              cache: "no-store",
              // Um redirect aqui e sempre bug (SSO, dominio errado): seguir o 3xx
              // esconderia a falha de novo.
              redirect: "manual",
              signal: controller.signal,
            })
            if (res.ok) return
            deps.log(eventoDeFalha, { nextCursor, status: res.status, attempt })
          } catch (error) {
            const message =
              error instanceof Error && error.name === "AbortError"
                ? "timeout"
                : error instanceof Error
                  ? error.message.slice(0, 300)
                  : "unknown"
            deps.log(eventoDeFalha, { nextCursor, message, attempt })
          } finally {
            clearTimeout(timer)
          }
          if (!ultimaTentativa) {
            await deps.sleep(CHAIN_FETCH_RETRY_DELAY_MS)
          }
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

    // Mesmo contrato de alerta do send-digest: 500 e o que faz a Vercel notificar.
    // Antes de 2026-08-03 esta rota respondia 200 mesmo com o lote inteiro em erro
    // ou com o teto de encadeamento cortando candidatos, entao a coorte alem da
    // posicao 205 (ordenada por slug) simplesmente nunca era atualizada e ninguem
    // era avisado.
    const loteInteiroFalhou =
      summary.processed > 0 && summary.errors.length === summary.processed
    const filaTruncada = hasMore && !shouldChain
    const degradado = loteInteiroFalhou || filaTruncada
    const status = degradado ? 500 : 200

    if (degradado) {
      deps.log(loteInteiroFalhou ? "lote_inteiro_falhou" : "chain_depth_exhausted", {
        cursor,
        nextCursor,
        total,
        chainDepth,
        errorCount: summary.errors.length,
        loteSize: summary.processed,
      })
    }

    deps.log("batch_complete", {
      cursor,
      limit,
      chainDepth,
      paginas,
      processed: summary.processed,
      withNews: summary.withNews,
      rowsUpserted: summary.rowsUpserted,
      discardedByName: summary.discardedByName,
      errorCount: summary.errors.length,
      coletaLinhas: summary.coletas.length,
      coletaLogOk,
      duracaoMs: Date.now() - inicio,
      nextCursor: hasMore ? nextCursor : null,
      chainScheduled: hasMore && shouldChain,
      revalidated: revalidatedTag,
      revalidateRequested: shouldRevalidateGlobalFichaCache,
      total,
      degradado,
    })

    return NextResponse.json(
      {
        ok: !degradado,
        degradado: degradado
          ? { loteInteiroFalhou, filaTruncada, motivo: loteInteiroFalhou ? "todos os candidatos do lote falharam" : "teto de encadeamento atingido com fila pendente" }
          : null,
        cursor,
        limit,
        chainDepth,
        paginas,
        processed: summary.processed,
        withNews: summary.withNews,
        rowsUpserted: summary.rowsUpserted,
        discardedByName: summary.discardedByName,
        errors: summary.errors,
        coletaLinhas: summary.coletas.length,
        coletaLogOk,
        nextCursor: hasMore ? nextCursor : null,
        chainScheduled: hasMore && shouldChain,
        revalidated: revalidatedTag,
        revalidateRequested: shouldRevalidateGlobalFichaCache,
        total,
      },
      { status },
    )
  }
}

const handler = createNewsRefreshHandler()

// Vercel Cron dispara via GET (injeta Authorization: Bearer <CRON_SECRET>). O
// auto-encadeamento e o disparo manual usam POST. Mesmo handler nos dois.
export const GET = handler
export const POST = handler
