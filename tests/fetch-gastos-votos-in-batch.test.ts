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

describe("fetchLegislacaoMandatoExecutivoRowsPaged", () => {
  test("busca paginas depois do limite default de 1000 linhas do PostgREST", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => buildLegislacaoRow(index + 1))
    const ranges: Array<{ from: number; to: number }> = []

    const supabase = {
      from(table: string) {
        assert.equal(table, "legislacao_mandato_executivo")
        return {
          select(columns: string) {
            assert.equal(columns, LEGISLACAO_MANDATO_EXECUTIVO_PUBLIC_SELECT)
            assert.doesNotMatch(
              columns,
              /historico_politico_id|esfera|uf_norma|municipio_norma|fonte_primaria_titulo|fonte_tramitacao_url|identificador_fonte|created_at/,
            )
            return this
          },
          eq(column: string, value: string) {
            assert.equal(column, "candidato_id")
            assert.equal(value, "candidate-1")
            return this
          },
          async range(from: number, to: number) {
            ranges.push({ from, to })
            return { data: rows.slice(from, to + 1), error: null }
          },
        }
      },
    } as unknown as SupabaseClient

    const result = await fetchLegislacaoMandatoExecutivoRowsPaged(supabase, "candidate-1")

    assert.equal(result.length, 1001)
    assert.deepEqual(ranges, [
      { from: 0, to: 249 },
      { from: 250, to: 499 },
      { from: 500, to: 749 },
      { from: 750, to: 999 },
      { from: 1000, to: 1249 },
    ])
  })
})
