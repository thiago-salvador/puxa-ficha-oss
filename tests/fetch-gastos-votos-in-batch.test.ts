import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  fetchLegislacaoMandatoExecutivoRowsPaged,
  LEGISLACAO_MANDATO_EXECUTIVO_PUBLIC_SELECT,
} from "@/lib/fetch-gastos-votos-in-batch"
import type { LegislacaoMandatoExecutivo } from "@/lib/types"

function buildLegislacaoRow(index: number): LegislacaoMandatoExecutivo {
  return {
    id: `row-${index}`,
    candidato_id: "candidate-1",
    historico_politico_id: null,
    tipo_relacao: "lei_sancionada",
    esfera: "estadual",
    uf_norma: "RS",
    municipio_norma: null,
    tipo_norma: "lei",
    numero: String(index),
    ano: 2026,
    data_norma: "2026-04-24",
    ementa: `Lei ${index}`,
    signatario: "EDUARDO LEITE",
    autoridade_papel: "titular",
    fonte_primaria_url: "https://www.diariooficial.rs.gov.br/materia?id=1",
    fonte_primaria_titulo: "Diario Oficial do Estado do Rio Grande do Sul",
    fonte_tramitacao_url: null,
    identificador_fonte: `DOE-RS:${index}`,
    metadata: {},
    created_at: "2026-04-27T00:00:00.000Z",
  }
}

type PageRequest = { from: number; to: number; signal: AbortSignal | null }

/**
 * Cliente fake com a forma do PostgREST: `.range()` devolve o builder (nao a
 * resposta), entao `.abortSignal()` ainda pode ser encadeado antes do await.
 */
function createSupabaseStub(rows: LegislacaoMandatoExecutivo[], requests: PageRequest[]) {
  return {
    from(table: string) {
      assert.equal(table, "legislacao_mandato_executivo")
      const pending: PageRequest = { from: 0, to: 0, signal: null }
      const builder = {
        select(columns: string) {
          assert.equal(columns, LEGISLACAO_MANDATO_EXECUTIVO_PUBLIC_SELECT)
          assert.doesNotMatch(
            columns,
            /historico_politico_id|esfera|uf_norma|municipio_norma|fonte_primaria_titulo|fonte_tramitacao_url|identificador_fonte|created_at/,
          )
          return builder
        },
        eq(column: string, value: string) {
          assert.equal(column, "candidato_id")
          assert.equal(value, "candidate-1")
          return builder
        },
        range(from: number, to: number) {
          pending.from = from
          pending.to = to
          return builder
        },
        abortSignal(signal: AbortSignal) {
          pending.signal = signal
          return builder
        },
        then(
          resolve: (value: { data: LegislacaoMandatoExecutivo[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) {
          requests.push({ ...pending })
          return Promise.resolve({
            data: rows.slice(pending.from, pending.to + 1),
            error: null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe("fetchLegislacaoMandatoExecutivoRowsPaged", () => {
  test("busca paginas depois do limite default de 1000 linhas do PostgREST", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => buildLegislacaoRow(index + 1))
    const requests: PageRequest[] = []

    const result = await fetchLegislacaoMandatoExecutivoRowsPaged(
      createSupabaseStub(rows, requests),
      "candidate-1",
    )

    assert.equal(result.length, 1001)
    assert.deepEqual(
      requests.map(({ from, to }) => ({ from, to })),
      [
        { from: 0, to: 249 },
        { from: 250, to: 499 },
        { from: 500, to: 749 },
        { from: 750, to: 999 },
        { from: 1000, to: 1249 },
      ],
    )
  })

  test("repassa o signal do withSupabaseRetry para todas as paginas", async () => {
    const rows = Array.from({ length: 600 }, (_, index) => buildLegislacaoRow(index + 1))
    const requests: PageRequest[] = []
    const controller = new AbortController()

    await fetchLegislacaoMandatoExecutivoRowsPaged(
      createSupabaseStub(rows, requests),
      "candidate-1",
      controller.signal,
    )

    assert.equal(requests.length, 3)
    for (const [index, request] of requests.entries()) {
      assert.equal(
        request.signal,
        controller.signal,
        `pagina ${index + 1} nao recebeu o signal da tentativa`,
      )
    }
  })

  test("para de paginar quando a tentativa e abortada", async () => {
    // Sem esse corte, o timeout de 15s do wrapper degradava a ficha enquanto a
    // paginacao continuava abrindo requests ao Supabase, um por pagina restante.
    const rows = Array.from({ length: 2000 }, (_, index) => buildLegislacaoRow(index + 1))
    const requests: PageRequest[] = []
    const controller = new AbortController()

    const supabase = createSupabaseStub(rows, requests)
    const aborting = {
      from(table: string) {
        const builder = supabase.from(table) as unknown as {
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => unknown
        }
        const original = builder.then.bind(builder)
        builder.then = (resolve, reject) => {
          controller.abort() // aborta assim que a primeira pagina responde
          return original(resolve, reject)
        }
        return builder
      },
    } as unknown as SupabaseClient

    await assert.rejects(
      () => fetchLegislacaoMandatoExecutivoRowsPaged(aborting, "candidate-1", controller.signal),
      (error: unknown) => (error as { name?: string }).name === "AbortError",
    )
    assert.equal(requests.length, 1, "nenhuma pagina extra pode ser aberta apos o abort")
  })
})
