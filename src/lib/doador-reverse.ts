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
    // LANCA em vez de retornar o estado de erro. Um valor resolvido seria gravado
    // pelo unstable_cache abaixo e serviria a mensagem de falha por 1 HORA a todo
    // mundo que buscasse o mesmo termo, com cache HIT e sem nenhum log novo: um
    // blip de 45s no Supabase virava 1h de resultado errado, invisivel na
    // observabilidade. Rejeicao nao entra no Data Cache. Mesma mecanica que o
    // PR #40 aplicou aos 9 wrappers de src/lib/api.ts; este arquivo ficou de fora
    // na epoca e foi reencontrado no master review de 2026-08-03.
    throw new DoadorReverseUnavailableError(error.message)
  }

  return {
    rows: parseDoadorReverseRpcRows(data),
    error: null,
  }
}

/** Falha de leitura da RPC. Existe para nunca ser confundida com "0 resultados". */
class DoadorReverseUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DoadorReverseUnavailableError"
  }
}

const getCachedDoadorReverseRows = unstable_cache(
  async (normalizedQuery: string) => fetchDoadorReverseRows(normalizedQuery),
  // Sufixo trocado para descartar o cache ja envenenado no deploy, do mesmo jeito
  // que o PR #40 fez com `cache-poison-fix-20260802` nos wrappers de api.ts.
  ["doador-reverse", "cache-poison-fix-20260803"],
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
  // O estado de erro e reconstruido AQUI, fora do unstable_cache, para que a
  // falha nunca seja persistida no Data Cache. A mensagem ao usuario e a mesma
  // de antes; o que muda e que a proxima request tenta o banco de novo em vez de
  // servir a falha por 1h.
  try {
    const { rows, error } = rpcCaller || FIXTURE_FILE
      ? await fetchDoadorReverseRows(normalizedQuery, rpcCaller)
      : await getCachedDoadorReverseRows(normalizedQuery)
    return { rows, displayQuery, normalizedQuery, error }
  } catch {
    return {
      rows: [],
      displayQuery,
      normalizedQuery,
      error: "Não foi possível carregar os resultados agora.",
    }
  }
}
