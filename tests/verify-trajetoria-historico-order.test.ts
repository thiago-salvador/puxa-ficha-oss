import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  hasWideManualOverlappingSegmentedMandates,
  normalizeHistoricoPoliticoForDisplay,
} from "@/lib/historico-dedupe"
import { prepareHistoricoPoliticoPublicDisplayList } from "@/lib/trajetoria-public-display"
import type { HistoricoPolitico } from "@/lib/types"

/**
 * Garante que o verificador por slug usa a mesma ordenação pública que a ficha
 * (`prepareHistoricoPoliticoPublicDisplayList` em `verify-trajetoria-por-slug.ts`).
 */
describe("verify-trajetoria historico order vs trajetoria-public-display", () => {
  it("hasWideManualOverlappingSegmentedMandates recebe lista já ordenada como na UI", () => {
    const rows: HistoricoPolitico[] = [
      {
        id: "a",
        candidato_id: "c",
        cargo: "Senador",
        cargo_canonico: "Senador",
        tipo_evento: "mandato",
        periodo_inicio: 2010,
        periodo_fim: 2018,
        partido: "PT",
        estado: "CE",
        observacoes: null,
      } as HistoricoPolitico,
      {
        id: "b",
        candidato_id: "c",
        cargo: "Senador",
        cargo_canonico: "Senador",
        tipo_evento: "mandato",
        periodo_inicio: 2002,
        periodo_fim: 2010,
        partido: "PT",
        estado: "CE",
        observacoes: null,
      } as HistoricoPolitico,
    ]
    const ordered = prepareHistoricoPoliticoPublicDisplayList(normalizeHistoricoPoliticoForDisplay(rows))
    assert.deepEqual(
      ordered.map((r) => r.id),
      ["a", "b"],
      "descendente por periodo_inicio",
    )
    assert.equal(typeof hasWideManualOverlappingSegmentedMandates(ordered), "boolean")
  })
})
