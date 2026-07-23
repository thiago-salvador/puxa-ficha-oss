import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, it } from "node:test"

const require = createRequire(import.meta.url)
const serverOnlyPath = require.resolve("server-only")
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as never

const { NextRequest } = require("next/server") as typeof import("next/server")
const { createNewsRefreshHandler } = require("../src/app/api/news/refresh/route") as typeof import("../src/app/api/news/refresh/route")

const CRON_SECRET = "cron-secret-news-test"
const ROUTE_URL = "https://puxaficha.com.br/api/news/refresh"

interface FakeCandidato {
  id: string
  slug: string
  nome_urna: string
  cargo_disputado: string | null
}

function makeCandidatos(total: number): FakeCandidato[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `id-${i}`,
    slug: `cand-${i}`,
    nome_urna: `Cand ${i}`,
    cargo_disputado: "Deputado Federal",
  }))
}

interface Captured {
  afterCallbacks: Array<() => Promise<void> | void>
  revalidatedTags: string[]
  fetchCalls: Array<{ url: string; init?: RequestInit }>
  pageCalls: Array<{ cursor: number; limit: number }>
  refreshedBatches: FakeCandidato[][]
}

function createDeps(allCandidatos: FakeCandidato[]) {
  const captured: Captured = {
    afterCallbacks: [],
    revalidatedTags: [],
    fetchCalls: [],
    pageCalls: [],
    refreshedBatches: [],
  }

  const deps = {
    fetchCandidatoPage: async ({ cursor, limit }: { cursor: number; limit: number }) => {
      captured.pageCalls.push({ cursor, limit })
      return {
        candidatos: allCandidatos.slice(cursor, cursor + limit),
        total: allCandidatos.length,
      }
    },
    refreshNews: async (candidatos: FakeCandidato[]) => {
      captured.refreshedBatches.push(candidatos)
      return {
        processed: candidatos.length,
        withNews: candidatos.length,
        rowsUpserted: candidatos.length * 20,
        errors: [] as Array<{ slug: string; error: string }>,
      }
    },
    revalidate: (tag: string) => {
      captured.revalidatedTags.push(tag)
    },
    afterResponse: (cb: () => Promise<void> | void) => {
      captured.afterCallbacks.push(cb)
    },
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      captured.fetchCalls.push({ url: String(url), init })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch,
    log: () => {},
  }

  return { deps, captured }
}

function makeRequest(params: Record<string, string> = {}, opts: { secret?: string | null } = {}) {
  const url = new URL(ROUTE_URL)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  const secret = opts.secret === undefined ? CRON_SECRET : opts.secret
  if (secret !== null) headers.Authorization = `Bearer ${secret}`
  return new NextRequest(url, { method: "POST", headers })
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe("news refresh route", () => {
  const savedSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
  })

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = savedSecret
  })

  it("rejects requests without a valid CRON_SECRET", async () => {
    const { deps, captured } = createDeps(makeCandidatos(10))
    const handler = createNewsRefreshHandler(deps)

    const noSecret = await handler(makeRequest({}, { secret: null }))
    assert.equal(noSecret.status, 401)

    const wrongSecret = await handler(makeRequest({}, { secret: "wrong" }))
    assert.equal(wrongSecret.status, 401)

    // Nenhum trabalho roda quando a auth falha.
    assert.equal(captured.pageCalls.length, 0)
    assert.equal(captured.refreshedBatches.length, 0)
  })

  it("returns 503 when the candidate page query fails", async () => {
    const { deps } = createDeps(makeCandidatos(10))
    deps.fetchCandidatoPage = async () => {
      throw new Error("db down")
    }
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest())
    assert.equal(res.status, 503)
  })

  it("processes a single batch, does not chain, and does not flush the global ficha cache by default", async () => {
    const { deps, captured } = createDeps(makeCandidatos(4))
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5" }))
    const body = await readJson(res)

    assert.equal(res.status, 200)
    assert.equal(body.processed, 4)
    assert.equal(body.nextCursor, null)
    assert.equal(body.chainScheduled, false)
    assert.equal(body.revalidated, null)
    assert.equal(body.revalidateRequested, false)
    // total <= limit: sem encadeamento e sem flush global automatico.
    assert.equal(captured.afterCallbacks.length, 0)
    assert.deepEqual(captured.revalidatedTags, [])
  })

  it("schedules a chained self-invocation and does NOT flush while more remain", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5" }))
    const body = await readJson(res)

    assert.equal(res.status, 200)
    assert.equal(body.processed, 5)
    assert.equal(body.nextCursor, 5)
    assert.equal(body.chainScheduled, true)
    assert.equal(body.revalidated, null)
    // hasMore: nao revalida ainda.
    assert.deepEqual(captured.revalidatedTags, [])
    assert.equal(captured.afterCallbacks.length, 1)

    // O callback agendado chama a propria rota com o proximo cursor + bearer.
    await captured.afterCallbacks[0]()
    assert.equal(captured.fetchCalls.length, 1)
    const chained = captured.fetchCalls[0]
    assert.match(chained.url, /cursor=5/)
    assert.match(chained.url, /depth=1/)
    assert.match(chained.url, /chain=1/)
    assert.equal(chained.init?.method, "POST")
    assert.equal(
      (chained.init?.headers as Record<string, string>).Authorization,
      `Bearer ${CRON_SECRET}`,
    )
  })

  it("preserves explicit manual revalidation across chained self-invocations", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5", revalidate: "1" }))
    const body = await readJson(res)

    assert.equal(res.status, 200)
    assert.equal(body.chainScheduled, true)
    assert.equal(body.revalidated, null)
    assert.equal(body.revalidateRequested, true)
    assert.deepEqual(captured.revalidatedTags, [])
    assert.equal(captured.afterCallbacks.length, 1)

    await captured.afterCallbacks[0]()
    assert.equal(captured.fetchCalls.length, 1)
    assert.match(captured.fetchCalls[0].url, /revalidate=1/)
  })

  it("does not flush cache on the last batch of a chain unless explicitly requested", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    // cursor=10, limit=5 cobre os candidatos 10..12 (3), encerrando o universo.
    const res = await handler(makeRequest({ cursor: "10", limit: "5", depth: "2" }))
    const body = await readJson(res)

    assert.equal(body.processed, 3)
    assert.equal(body.nextCursor, null)
    assert.equal(body.chainScheduled, false)
    assert.equal(body.revalidated, null)
    assert.equal(body.revalidateRequested, false)
    assert.deepEqual(captured.revalidatedTags, [])
  })

  it("flushes the global ficha cache on the final batch when manual revalidation is requested", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ cursor: "10", limit: "5", depth: "2", revalidate: "1" }))
    const body = await readJson(res)

    assert.equal(body.processed, 3)
    assert.equal(body.nextCursor, null)
    assert.equal(body.chainScheduled, false)
    assert.equal(body.revalidated, "public-candidato-ficha")
    assert.equal(body.revalidateRequested, true)
    assert.deepEqual(captured.revalidatedTags, ["public-candidato-ficha"])
  })

  it("stops chaining when MAX_CHAIN_DEPTH is reached even if more remain", async () => {
    const { deps, captured } = createDeps(makeCandidatos(100))
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ cursor: "0", limit: "5", depth: "40" }))
    const body = await readJson(res)

    // Ainda ha mais candidatos, mas o encadeamento para no teto de profundidade.
    assert.equal(body.chainScheduled, false)
    assert.equal(captured.afterCallbacks.length, 0)
    // hasMore segue true, entao NAO revalida (lote nao-final).
    assert.deepEqual(captured.revalidatedTags, [])
  })
})
