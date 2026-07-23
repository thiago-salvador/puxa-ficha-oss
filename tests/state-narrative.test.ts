import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { IndicadorEstadual } from "@/lib/types"
import type { StateIndicatorRank, StateRankingResult } from "@/lib/state-ranking"
import { buildStateNarrative } from "@/lib/state-narrative"

function ind(
  estado: string,
  indicador: string,
  valor: number,
  ano: number
): IndicadorEstadual {
  return {
    id: `${estado}-${indicador}-${ano}`,
    estado,
    ano,
    fonte: "test",
    indicador,
    valor,
    valor_texto: null,
    unidade: null,
    metadata: null,
  }
}

function rank(partial: Omit<StateIndicatorRank, "label" | "qualidade" | "fonte"> & { label?: string; fonte?: string | null }): StateIndicatorRank {
  const lower = ["homicidios_100k", "gini", "taxa_desemprego", "taxa_pobreza"].includes(partial.indicador)
  let qualidade: StateIndicatorRank["qualidade"]
  if (lower) {
    qualidade = partial.valor < partial.mediaNacional ? "bom" : partial.valor > partial.mediaNacional ? "ruim" : "neutro"
  } else {
    qualidade = partial.valor > partial.mediaNacional ? "bom" : partial.valor < partial.mediaNacional ? "ruim" : "neutro"
  }
  return {
    ...partial,
    fonte: partial.fonte ?? null,
    label: partial.label ?? `${partial.posicao}o de ${partial.total}`,
    qualidade,
  }
}

describe("buildStateNarrative", () => {
  it("returns empty when there are no ranking rows", () => {
    const n = buildStateNarrative({ estado: "SP", rankings: [] }, "Sao Paulo", [])
    assert.deepEqual(n, [])
  })

  it("includes top and bottom phrasing when rankings hit both buckets", () => {
    const ranking: StateRankingResult = {
      estado: "SP",
      rankings: [
        rank({
          indicador: "gini",
          valor: 0.45,
          ano: 2024,
          posicao: 2,
          total: 10,
          acimaDaMedia: false,
          mediaNacional: 0.52,
        }),
        rank({
          indicador: "homicidios_100k",
          valor: 35,
          ano: 2024,
          posicao: 9,
          total: 10,
          acimaDaMedia: true,
          mediaNacional: 20,
        }),
      ],
    }
    const n = buildStateNarrative(ranking, "Sao Paulo", [])
    assert.ok(n.some((p) => p.toLowerCase().includes("melhor desempenho")))
    assert.ok(n.some((p) => p.includes("piores")))
  })

  it("uses mid-pack fallback when no extreme sentences apply", () => {
    const ranking: StateRankingResult = {
      estado: "SP",
      rankings: [
        rank({
          indicador: "gini",
          valor: 0.52,
          ano: 2024,
          posicao: 10,
          total: 20,
          acimaDaMedia: false,
          mediaNacional: 0.51,
        }),
      ],
    }
    const n = buildStateNarrative(ranking, "Sao Paulo", [])
    assert.equal(n.length, 1)
    assert.ok(n[0].includes("Sao Paulo"))
    assert.ok(n[0].includes("gini") || n[0].includes("Gini") || n[0].includes("ndice de Gini"))
  })

  it("adds trend sentence when two anos diverge enough", () => {
    const ranking: StateRankingResult = { estado: "SP", rankings: [] }
    const indicadores: IndicadorEstadual[] = [
      ind("SP", "pib_total", 100, 2024),
      ind("SP", "pib_total", 80, 2023),
    ]
    const n = buildStateNarrative(ranking, "Sao Paulo", indicadores)
    assert.ok(n.some((p) => p.includes("PIB") || p.includes("subiu")))
  })

  it("skips trend when change is strictly below 10%", () => {
    const ranking: StateRankingResult = { estado: "SP", rankings: [] }
    const indicadores: IndicadorEstadual[] = [
      ind("SP", "pib_total", 100, 2024),
      ind("SP", "pib_total", 91, 2023),
    ]
    const n = buildStateNarrative(ranking, "Sao Paulo", indicadores)
    assert.ok(!n.some((p) => p.includes("PIB Total") || p.includes("subiu") || p.includes("caiu")))
  })

  it("includes trend at exactly 10% change (boundary, inclusive)", () => {
    const ranking: StateRankingResult = { estado: "SP", rankings: [] }
    const indicadores: IndicadorEstadual[] = [
      ind("SP", "pib_total", 110, 2024),
      ind("SP", "pib_total", 100, 2023),
    ]
    const n = buildStateNarrative(ranking, "Sao Paulo", indicadores)
    assert.ok(n.some((p) => p.includes("PIB") && p.includes("subiu")))
  })

  it("treats PIB rise as favorable (lowerIsBetter false)", () => {
    const ranking: StateRankingResult = { estado: "SP", rankings: [] }
    const indicadores: IndicadorEstadual[] = [
      ind("SP", "pib_total", 120, 2024),
      ind("SP", "pib_total", 100, 2023),
    ]
    const n = buildStateNarrative(ranking, "Sao Paulo", indicadores)
    assert.ok(n.some((p) => p.includes("favorável") || p.includes("favoravel")))
  })

  it("treats PIB drop as needing attention (lowerIsBetter false)", () => {
    const ranking: StateRankingResult = { estado: "SP", rankings: [] }
    const indicadores: IndicadorEstadual[] = [
      ind("SP", "pib_total", 88, 2024),
      ind("SP", "pib_total", 100, 2023),
    ]
    const n = buildStateNarrative(ranking, "Sao Paulo", indicadores)
    assert.ok(n.some((p) => p.includes("atenção") || p.includes("atencao")))
  })

  it("does not emit top/bottom editorial when total UFs in ranking is below 5", () => {
    const ranking: StateRankingResult = {
      estado: "SP",
      rankings: [
        rank({
          indicador: "gini",
          valor: 0.4,
          ano: 2024,
          posicao: 1,
          total: 4,
          acimaDaMedia: false,
          mediaNacional: 0.5,
        }),
      ],
    }
    const n = buildStateNarrative(ranking, "Sao Paulo", [])
    assert.ok(!n.some((p) => p.includes("melhor desempenho")))
    assert.ok(!n.some((p) => p.includes("piores")))
    assert.equal(n.length, 1)
    assert.ok(n[0].includes("Sao Paulo"))
  })
})
