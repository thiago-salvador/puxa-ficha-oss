import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ingestWikidata,
  type IngestWikidataDependencies,
} from "../scripts/lib/ingest-wikidata"

const candidatoBase = {
  slug: "candidato-teste",
  nome_completo: "Candidato Teste",
  nome_urna: "Candidato Teste",
  cargo_disputado: "Governador" as const,
  estado: "SP",
  ids: { camara: null, senado: null, tse_sq_candidato: {} },
}

type DbOptions = {
  row?: Record<string, unknown> | null
  selectError?: string
  updateError?: string
}

function database(options: DbOptions = {}): IngestWikidataDependencies["database"] {
  const row = options.row === undefined
    ? {
        redes_sociais: {},
        wikidata_id: "Q123",
        foto_url: null,
        data_nascimento: null,
        profissao_declarada: null,
      }
    : options.row

  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: row,
            error: options.selectError ? { message: options.selectError } : null,
          }),
        }),
      }),
      update: () => ({
        eq: async () => ({
          data: null,
          error: options.updateError ? { message: options.updateError } : null,
        }),
      }),
    }),
  } as unknown as IngestWikidataDependencies["database"]
}

function fetchSequence(...steps: unknown[]): IngestWikidataDependencies["fetchJson"] {
  let index = 0
  return (async <T>() => {
    const step = steps[index++]
    if (step instanceof Error) throw step
    return step as T
  }) as IngestWikidataDependencies["fetchJson"]
}

async function executar(overrides: {
  candidate?: typeof candidatoBase & { wikipedia_title?: string }
  db?: DbOptions
  fetch?: IngestWikidataDependencies["fetchJson"]
}) {
  let fetchCalls = 0
  const fetchJson = overrides.fetch ?? fetchSequence({ results: { bindings: [] } })
  const countedFetch: IngestWikidataDependencies["fetchJson"] = async <T>(...args: Parameters<IngestWikidataDependencies["fetchJson"]>) => {
    fetchCalls++
    return fetchJson<T>(...args)
  }
  const [result] = await ingestWikidata({
    database: database(overrides.db),
    loadCandidates: async () => [overrides.candidate ?? candidatoBase],
    resolveCandidateId: async () => "candidate-id",
    fetchJson: countedFetch,
    wait: async () => {},
  })
  return { result, fetchCalls }
}

describe("ingestWikidata: desfecho da coleta", () => {
  it("binding existente continua encontrado mesmo sem UPDATE", async () => {
    const { result } = await executar({
      fetch: fetchSequence({
        results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q123" } }] },
      }),
    })

    assert.equal(result.rows_upserted, 0)
    assert.equal(result.coleta_resultado, "encontrado")
    assert.equal(result.coleta_volume, 1)
  })

  it("binding novo e encontrado e preserva a escrita", async () => {
    const { result } = await executar({
      db: {
        row: {
          redes_sociais: {}, wikidata_id: "Q123", foto_url: null,
          data_nascimento: null, profissao_declarada: null,
        },
      },
      fetch: fetchSequence({
        results: {
          bindings: [{
            item: { value: "http://www.wikidata.org/entity/Q123" },
            instagram: { value: "perfil_teste" },
          }],
        },
      }),
    })

    assert.equal(result.rows_upserted, 1)
    assert.deepEqual(result.tables_updated, ["candidatos"])
    assert.equal(result.coleta_resultado, "encontrado")
    assert.equal(result.coleta_volume, 1)
  })

  it("SPARQL valido vazio vira vazio_confirmado", async () => {
    const { result } = await executar({ fetch: fetchSequence({ results: { bindings: [] } }) })
    assert.equal(result.coleta_resultado, "vazio_confirmado")
    assert.equal(result.coleta_volume, undefined)
    assert.deepEqual(result.errors, [])
  })

  it("sem QID e sem rota Wikipedia e nao_aplicavel sem consulta inventada", async () => {
    const { result, fetchCalls } = await executar({
      db: {
        row: {
          redes_sociais: {}, wikidata_id: null, foto_url: null,
          data_nascimento: null, profissao_declarada: null,
        },
      },
    })
    assert.equal(fetchCalls, 0)
    assert.equal(result.coleta_resultado, "nao_aplicavel")
  })

  it("fallback via Wikipedia resolve QID antes de consultar Wikidata", async () => {
    const { result, fetchCalls } = await executar({
      candidate: { ...candidatoBase, wikipedia_title: "Pagina Teste" },
      db: {
        row: {
          redes_sociais: {}, wikidata_id: null, foto_url: null,
          data_nascimento: null, profissao_declarada: null,
        },
      },
      fetch: fetchSequence(
        { query: { pages: { "1": { pageprops: { wikibase_item: "Q456" } } } } },
        {
          results: {
            bindings: [{ item: { value: "http://www.wikidata.org/entity/Q456" } }],
          },
        },
      ),
    })

    assert.equal(fetchCalls, 2)
    assert.equal(result.coleta_resultado, "encontrado")
    assert.equal(result.coleta_volume, 1)
    assert.match(result.coleta_detalhe ?? "", /QID da Wikipedia/)
  })

  it("Wikipedia valida sem pagina ou sem QID deixa Wikidata nao aplicavel", async () => {
    for (const wikipedia of [
      { query: { pages: { "-1": { missing: "" } } } },
      { query: { pages: { "1": { pageprops: {} } } } },
    ]) {
      const { result, fetchCalls } = await executar({
        candidate: { ...candidatoBase, wikipedia_title: "Pagina Teste" },
        db: {
          row: {
            redes_sociais: {}, wikidata_id: null, foto_url: null,
            data_nascimento: null, profissao_declarada: null,
          },
        },
        fetch: fetchSequence(wikipedia),
      })
      assert.equal(fetchCalls, 1)
      assert.equal(result.coleta_resultado, "nao_aplicavel")
      assert.match(result.coleta_detalhe ?? "", /nenhuma consulta SPARQL/)
      assert.deepEqual(result.errors, [])
    }
  })

  it("HTTP, timeout e parse/shape nunca viram vazio", async () => {
    for (const failure of [
      new Error("HTTP 503"),
      new Error("timeout apos 10000ms"),
      { query: { pages: [] } },
    ]) {
      const { result } = await executar({
        candidate: { ...candidatoBase, wikipedia_title: "Pagina Teste" },
        db: {
          row: {
            redes_sociais: {}, wikidata_id: null, foto_url: null,
            data_nascimento: null, profissao_declarada: null,
          },
        },
        fetch: fetchSequence(failure),
      })
      assert.equal(result.coleta_resultado, "erro")
      assert.notEqual(result.coleta_resultado, "vazio_confirmado")
      assert.ok(result.errors.length > 0)
    }
  })

  it("shape SPARQL invalido vira erro", async () => {
    const { result } = await executar({ fetch: fetchSequence({ results: {} }) })
    assert.equal(result.coleta_resultado, "erro")
    assert.match(result.errors.join(" "), /results\.bindings/)
  })

  it("erros de SELECT e UPDATE do banco viram erro", async () => {
    const select = await executar({ db: { selectError: "select indisponivel" } })
    assert.equal(select.result.coleta_resultado, "erro")

    const update = await executar({
      db: { updateError: "update indisponivel" },
      fetch: fetchSequence({
        results: {
          bindings: [{
            item: { value: "http://www.wikidata.org/entity/Q123" },
            instagram: { value: "perfil_teste" },
          }],
        },
      }),
    })
    assert.equal(update.result.coleta_resultado, "erro")
    assert.match(update.result.errors.join(" "), /update indisponivel/)
  })
})
