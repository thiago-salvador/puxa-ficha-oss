import "server-only"

import * as Sentry from "@sentry/nextjs"
import { unstable_cache } from "next/cache"
import {
  parseDoadorReverseRpcRows,
  type DoadorReverseFinanciamentoRow,
  type DoadorReverseSearchResult,
} from "@/lib/doador-reverse-shared"
import { normalizeForSearch } from "@/lib/search-normalize"
import { createServerSupabaseClient, getAppSupabaseUrl } from "@/lib/supabase"

export {
  DOADOR_REVERSE_DISCLAIMER,
  type DoadorReverseFinanciamentoRow,
  type DoadorReverseSearchResult,
} from "@/lib/doador-reverse-shared"

const supabaseUrl = getAppSupabaseUrl()
const USE_MOCK = !supabaseUrl || supabaseUrl.includes("placeholder")

function resolveFixtureFile(): string | null {
  const raw = process.env.PF_DOADOR_REVERSE_FIXTURE_FILE?.trim()
  if (!raw) return null
  if (raw.startsWith("/")) return raw

  const filename = raw.split(/[\\/]/).filter(Boolean).at(-1)
  return filename ? `tests/fixtures/${filename}` : null
}

const FIXTURE_FILE = resolveFixtureFile()

async function readDoadorReverseFixture(filePath: string): Promise<DoadorReverseFinanciamentoRow[]> {
  const { readFile } = await import("node:fs/promises")
  const raw = await readFile(filePath, "utf-8")
  return parseDoadorReverseRpcRows(JSON.parse(raw))
}

/** RPC caller contract for dependency injection (tests). */
export interface DoadorReverseRpcCaller {
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

async function fetchDoadorReverseRows(
  normalizedQuery: string,
  rpcCaller?: DoadorReverseRpcCaller
): Promise<{ rows: DoadorReverseFinanciamentoRow[]; error: string | null }> {
  if (!normalizedQuery) {
    return { rows: [], error: null }
  }

  // Prioritize fixture when PF_DOADOR_REVERSE_FIXTURE_FILE is set (even in mock mode for tests)
  if (!rpcCaller && FIXTURE_FILE) {
    return Sentry.startSpan(
      {
        name: "doador_reverse.fixture_search",
        op: "db.fixture",
        attributes: {
          "http.route": "/doadores",
          "puxaficha.query_length": normalizedQuery.length,
        },
      },
      async () => {
        try {
          const allRows = await readDoadorReverseFixture(FIXTURE_FILE)
          const matching = allRows.filter(
            (r) => normalizeForSearch(r.doador_nome_exibicao).includes(normalizedQuery)
          )
          return { rows: matching, error: null }
        } catch {
          return { rows: [], error: null }
        }
      },
    )
  }

  if (!rpcCaller && USE_MOCK) {
    return {
      rows: [],
      error: "Dados indisponíveis sem Supabase configurado.",
    }
  }

  const { data, error } = await Sentry.startSpan(
    {
      name: "doador_reverse.rpc",
      op: "db.supabase.rpc",
      attributes: {
        "db.system": "postgresql",
        "db.operation": "search_financiamento_by_doador_normalized",
        "http.route": "/doadores",
        "puxaficha.query_length": normalizedQuery.length,
      },
    },
    async () => {
      const caller = rpcCaller ?? createServerSupabaseClient()
      return caller.rpc("search_financiamento_by_doador_normalized", {
        p_query: normalizedQuery,
      })
    },
  )

  if (error) {
    console.error("search_financiamento_by_doador_normalized:", error.message)
    return {
      rows: [],
      error: "Não foi possível carregar os resultados agora.",
    }
  }

  return {
    rows: parseDoadorReverseRpcRows(data),
    error: null,
  }
}

const getCachedDoadorReverseRows = unstable_cache(
  async (normalizedQuery: string) => fetchDoadorReverseRows(normalizedQuery),
  ["doador-reverse"],
  {
    revalidate: 3600,
    tags: ["doador-reverse"],
  }
)

/**
 * Busca campanhas em que o nome do doador (top 10 TSE) contém o termo normalizado.
 * Cache Next 1h, tag `doador-reverse`.
 * Pass `rpcCaller` or PF_DOADOR_REVERSE_FIXTURE_FILE to bypass cache and Supabase (tests).
 */
export async function getDoadorReverseSearchResult(
  rawQuery: string,
  rpcCaller?: DoadorReverseRpcCaller
): Promise<DoadorReverseSearchResult> {
  const displayQuery = rawQuery.trim()
  const normalizedQuery = normalizeForSearch(displayQuery)
  if (!normalizedQuery) {
    return { rows: [], displayQuery, normalizedQuery: "", error: null }
  }
  const { rows, error } = rpcCaller || FIXTURE_FILE
    ? await fetchDoadorReverseRows(normalizedQuery, rpcCaller)
    : await getCachedDoadorReverseRows(normalizedQuery)
  return { rows, displayQuery, normalizedQuery, error }
}
