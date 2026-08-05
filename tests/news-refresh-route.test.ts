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

interface ColetaTentativaFake {
  alvo: string
  candidato_id: string
  resultado: "encontrado" | "vazio_confirmado" | "erro"
  volume: number
  detalhe: string
  url: string
  duracao_ms: number
}

interface Captured {
  afterCallbacks: Array<() => Promise<void> | void>
  revalidatedTags: string[]
  fetchCalls: Array<{ url: string; init?: RequestInit }>
  pageCalls: Array<{ cursor: number; limit: number }>
  refreshedBatches: FakeCandidato[][]
  logCalls: Array<{ event: string; detail: Record<string, unknown> }>
  coletaBatches: ColetaTentativaFake[][]
  sleepCalls: number[]
}

function coletaDe(cand: FakeCandidato): ColetaTentativaFake {
  return {
    alvo: cand.slug,
    candidato_id: cand.id,
    resultado: "encontrado",
    volume: 20,
    detalhe: "rss respondeu 20 item(ns)",
    url: `https://news.google.com/rss/search?q=${cand.slug}`,
    duracao_ms: 10,
  }
}

function createDeps(allCandidatos: FakeCandidato[]) {
  const captured: Captured = {
    afterCallbacks: [],
    revalidatedTags: [],
    fetchCalls: [],
    pageCalls: [],
    refreshedBatches: [],
    logCalls: [],
    coletaBatches: [],
    sleepCalls: [],
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
        discardedByName: 0,
        errors: [] as Array<{ slug: string; error: string }>,
        coletas: candidatos.map(coletaDe),
      }
    },
    registrarColetas: async (tentativas: ColetaTentativaFake[]) => {
      captured.coletaBatches.push(tentativas)
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
    sleep: async (ms: number) => {
      captured.sleepCalls.push(ms)
    },
    log: (event: string, detail: Record<string, unknown>) => {
      captured.logCalls.push({ event, detail })
    },
    // 0 força uma página por invocação: é o modo que exercita o encadeamento
    // nos testes. O orçamento real (240s) é coberto pelos testes de orçamento.
    invocationBudgetMs: 0,
  }

  return { deps, captured }
}

function makeRequest(
  params: Record<string, string> = {},
  opts: { secret?: string | null; origin?: string } = {},
) {
  const url = new URL(opts.origin ? `${opts.origin}/api/news/refresh` : ROUTE_URL)
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
  const savedVercelEnv = process.env.VERCEL_ENV
  const savedChainOrigin = process.env.PF_CRON_CHAIN_ORIGIN

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
    delete process.env.VERCEL_ENV
    delete process.env.PF_CRON_CHAIN_ORIGIN
  })

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = savedSecret
    if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = savedVercelEnv
    if (savedChainOrigin === undefined) delete process.env.PF_CRON_CHAIN_ORIGIN
    else process.env.PF_CRON_CHAIN_ORIGIN = savedChainOrigin
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

  it("chains against the canonical origin in production even when invoked via *.vercel.app", async () => {
    // Cenario real do incidente de 2026-08-04: o cron da Vercel invoca a rota
    // pela URL do deployment, que fica atras do SSO. Encadear contra ela morre
    // num 302 silencioso, entao o chain deve mirar a origem canonica.
    process.env.VERCEL_ENV = "production"
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(
      makeRequest({ limit: "5" }, { origin: "https://puxa-ficha-abc123-thiagosalvador.vercel.app" }),
    )
    assert.equal(res.status, 200)
    assert.equal(captured.afterCallbacks.length, 1)

    await captured.afterCallbacks[0]()
    assert.equal(captured.fetchCalls.length, 1)
    const chainedUrl = new URL(captured.fetchCalls[0].url)
    assert.equal(chainedUrl.origin, "https://puxaficha.com.br")
    assert.equal(chainedUrl.pathname, "/api/news/refresh")
    assert.equal(chainedUrl.searchParams.get("cursor"), "5")
  })

  it("prefers PF_CRON_CHAIN_ORIGIN over the canonical fallback when set", async () => {
    process.env.VERCEL_ENV = "production"
    process.env.PF_CRON_CHAIN_ORIGIN = "https://staging.puxaficha.com.br"
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    await handler(
      makeRequest({ limit: "5" }, { origin: "https://puxa-ficha-abc123-thiagosalvador.vercel.app" }),
    )
    await captured.afterCallbacks[0]()
    assert.equal(new URL(captured.fetchCalls[0].url).origin, "https://staging.puxaficha.com.br")
  })

  it("keeps chaining against the request origin outside production", async () => {
    // Dev local e preview: sem VERCEL_ENV=production e sem override, o chain
    // continua apontando pra propria origem (preview nunca dispara producao).
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }, { origin: "http://localhost:3000" }))
    await captured.afterCallbacks[0]()
    assert.equal(new URL(captured.fetchCalls[0].url).origin, "http://localhost:3000")
  })

  it("logs chain_fetch_failed when the chained fetch answers non-2xx (e.g. SSO 302)", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    deps.fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      captured.fetchCalls.push({ url: String(url), init })
      return new Response(null, { status: 302, headers: { Location: "https://vercel.com/sso-api" } })
    }) as unknown as typeof fetch
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }))
    await captured.afterCallbacks[0]()

    const failure = captured.logCalls.find((c) => c.event === "chain_fetch_failed")
    assert.ok(failure, "esperava log chain_fetch_failed para resposta 302")
    assert.equal(failure.detail.status, 302)
    assert.equal(failure.detail.nextCursor, 5)
  })

  it("does not log chain_fetch_failed when the chained fetch answers 2xx", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }))
    await captured.afterCallbacks[0]()

    assert.equal(captured.logCalls.filter((c) => c.event === "chain_fetch_failed").length, 0)
  })

  it("processes the whole universe in one invocation when the budget allows, without chaining", async () => {
    // O motivo de existir do orçamento: a proteção anti-recursão da Vercel
    // devolve 508 no ~5º fetch encadeado (medido em produção em 2026-08-05),
    // então cobrir 194 candidatos com 39 hops nunca fecha. Com orçamento, a
    // invocação processa várias páginas e o chain quase não é usado.
    const { deps, captured } = createDeps(makeCandidatos(13))
    deps.invocationBudgetMs = 60_000
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5" }))
    const body = await readJson(res)

    assert.equal(res.status, 200)
    assert.equal(body.processed, 13)
    assert.equal(body.paginas, 3)
    assert.equal(body.nextCursor, null)
    assert.equal(body.chainScheduled, false)
    assert.deepEqual(
      captured.pageCalls.map((p) => p.cursor),
      [0, 5, 10],
    )
    // Pausa entre páginas, mas nenhuma após a última.
    assert.deepEqual(captured.sleepCalls, [1500, 1500])
    // Uma escrita de coleta_log por página, cobrindo todos os candidatos.
    assert.equal(captured.coletaBatches.flat().length, 13)
    assert.equal(captured.afterCallbacks.length, 0)
  })

  it("chains from the right cursor when the budget runs out mid-universe", async () => {
    const { deps } = createDeps(makeCandidatos(13))
    // Orçamento 0: esgota após a primeira página, o resto vai pelo chain.
    deps.invocationBudgetMs = 0
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5" }))
    const body = await readJson(res)

    assert.equal(res.status, 200)
    assert.equal(body.processed, 5)
    assert.equal(body.paginas, 1)
    assert.equal(body.nextCursor, 5)
    assert.equal(body.chainScheduled, true)
  })

  it("keeps the processed head and chains the tail when a mid-run page query fails", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    deps.invocationBudgetMs = 60_000
    const original = deps.fetchCandidatoPage
    let calls = 0
    deps.fetchCandidatoPage = async (args: { cursor: number; limit: number }) => {
      calls += 1
      if (calls === 2) throw new Error("db flake")
      return original(args)
    }
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5" }))
    const body = await readJson(res)

    // A cabeça processada não é perdida num 503: a resposta é 200 e a cauda
    // fica com o encadeamento, que retoma do cursor onde a consulta falhou.
    assert.equal(res.status, 200)
    assert.equal(body.processed, 5)
    assert.equal(body.nextCursor, 5)
    assert.equal(body.chainScheduled, true)
    const failure = captured.logCalls.find((c) => c.event === "candidato_page_failed")
    assert.ok(failure, "esperava log candidato_page_failed")
    assert.equal(failure.detail.cursor, 5)
  })

  it("records one coleta_log tentativa per processed candidate", async () => {
    const { deps, captured } = createDeps(makeCandidatos(4))
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5" }))
    const body = await readJson(res)

    assert.equal(res.status, 200)
    assert.equal(body.coletaLinhas, 4)
    assert.equal(body.coletaLogOk, true)
    assert.equal(captured.coletaBatches.length, 1)
    assert.equal(captured.coletaBatches[0].length, 4)
    assert.deepEqual(
      captured.coletaBatches[0].map((t) => t.alvo),
      ["cand-0", "cand-1", "cand-2", "cand-3"],
    )
  })

  it("keeps the batch alive when coleta_log write fails, logging coleta_log_failed", async () => {
    const { deps, captured } = createDeps(makeCandidatos(4))
    deps.registrarColetas = async () => {
      throw new Error("insert denied")
    }
    const handler = createNewsRefreshHandler(deps)

    const res = await handler(makeRequest({ limit: "5" }))
    const body = await readJson(res)

    // Telemetria nunca derruba o lote: resposta segue 200, com a falha visivel.
    assert.equal(res.status, 200)
    assert.equal(body.coletaLogOk, false)
    const failure = captured.logCalls.find((c) => c.event === "coleta_log_failed")
    assert.ok(failure, "esperava log coleta_log_failed")
    assert.equal(failure.detail.linhas, 4)
  })

  it("retries the chained fetch once before declaring chain_fetch_failed", async () => {
    const { deps, captured } = createDeps(makeCandidatos(13))
    let calls = 0
    deps.fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      captured.fetchCalls.push({ url: String(url), init })
      calls += 1
      if (calls === 1) throw new Error("socket hang up")
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }))
    await captured.afterCallbacks[0]()

    // Primeiro elo falhou, o retry salvou a fila do dia.
    assert.equal(captured.fetchCalls.length, 2)
    assert.equal(captured.logCalls.filter((c) => c.event === "chain_fetch_retry").length, 1)
    assert.equal(captured.logCalls.filter((c) => c.event === "chain_fetch_failed").length, 0)
    assert.deepEqual(captured.sleepCalls, [3000])
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

describe("news refresh route: prazo e origem do encadeamento", () => {
  const savedSecret = process.env.CRON_SECRET
  const savedVercelEnv = process.env.VERCEL_ENV
  const savedChainOrigin = process.env.PF_CRON_CHAIN_ORIGIN

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
    delete process.env.VERCEL_ENV
    delete process.env.PF_CRON_CHAIN_ORIGIN
  })

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = savedSecret
    if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = savedVercelEnv
    if (savedChainOrigin === undefined) delete process.env.PF_CRON_CHAIN_ORIGIN
    else process.env.PF_CRON_CHAIN_ORIGIN = savedChainOrigin
  })

  it("o fetch de encadeamento leva signal com prazo", async () => {
    const { deps, captured } = createDeps(makeCandidatos(10))
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }))
    for (const cb of captured.afterCallbacks) await cb()

    assert.equal(captured.fetchCalls.length, 1)
    // Sem signal, um POST interno travado nunca voltava: sem retry, sem
    // chain_fetch_failed e sem nova invocação para o resto da fila.
    assert.ok(captured.fetchCalls[0].init?.signal instanceof AbortSignal)
  })

  it("abort do prazo é registrado como timeout e ainda tenta de novo", async () => {
    const { deps, captured } = createDeps(makeCandidatos(10))
    deps.fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      captured.fetchCalls.push({ url: String(url), init })
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    }) as unknown as typeof fetch
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }))
    for (const cb of captured.afterCallbacks) await cb()

    const eventos = captured.logCalls.filter((l) => l.event.startsWith("chain_fetch_"))
    assert.deepEqual(
      eventos.map((e) => e.event),
      ["chain_fetch_retry", "chain_fetch_failed"],
    )
    for (const e of eventos) assert.equal(e.detail.message, "timeout")
  })

  it("origem http fora de loopback não recebe o CRON_SECRET", async () => {
    process.env.PF_CRON_CHAIN_ORIGIN = "http://puxaficha.com.br"
    const { deps, captured } = createDeps(makeCandidatos(10))
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }))
    for (const cb of captured.afterCallbacks) await cb()

    // Falha alta: nenhum fetch, e o motivo fica no log.
    assert.equal(captured.fetchCalls.length, 0)
    const rejeicao = captured.logCalls.find((l) => l.event === "chain_origin_rejected")
    assert.ok(rejeicao, "esperado chain_origin_rejected")
    assert.equal(rejeicao.detail.motivo, "sem_https")
  })

  it("origem https configurada continua encadeando normalmente", async () => {
    process.env.PF_CRON_CHAIN_ORIGIN = "https://staging.puxaficha.com.br"
    const { deps, captured } = createDeps(makeCandidatos(10))
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }))
    for (const cb of captured.afterCallbacks) await cb()

    assert.equal(captured.fetchCalls.length, 1)
    assert.ok(captured.fetchCalls[0].url.startsWith("https://staging.puxaficha.com.br/"))
    assert.equal(captured.logCalls.filter((l) => l.event === "chain_origin_rejected").length, 0)
  })

  it("loopback em http segue liberado, para o desenvolvimento local", async () => {
    const { deps, captured } = createDeps(makeCandidatos(10))
    const handler = createNewsRefreshHandler(deps)

    await handler(makeRequest({ limit: "5" }, { origin: "http://localhost:3000" }))
    for (const cb of captured.afterCallbacks) await cb()

    assert.equal(captured.fetchCalls.length, 1)
    assert.ok(captured.fetchCalls[0].url.startsWith("http://localhost:3000/"))
  })
})
