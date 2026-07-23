export interface StateIndicatorConfig {
  label: string
  format: (value: number) => string
  /** true = lower is better (homicidios, pobreza, desemprego, gini) */
  lowerIsBetter: boolean
}

export const STATE_INDICATOR_CONFIG: Record<string, StateIndicatorConfig> = {
  homicidios_100k: {
    label: "Homicídios por 100k hab.",
    format: (v) => v.toFixed(1),
    lowerIsBetter: true,
  },
  pib_total: {
    label: "PIB Total",
    format: (v) => {
      const billions = v / 1_000_000
      if (billions >= 1) return `R$ ${billions.toFixed(0)} bi`
      const millions = v / 1_000
      return `R$ ${millions.toFixed(0)} mi`
    },
    lowerIsBetter: false,
  },
  populacao_estimada: {
    label: "População",
    format: (v) => {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} mi`
      if (v >= 1_000) return `${(v / 1_000).toFixed(0)} mil`
      return v.toFixed(0)
    },
    lowerIsBetter: false,
  },
  gini: {
    label: "Índice de Gini",
    format: (v) => v.toFixed(3),
    lowerIsBetter: true,
  },
  taxa_desemprego: {
    label: "Taxa de Desemprego",
    format: (v) => `${v.toFixed(1)}%`,
    lowerIsBetter: true,
  },
  taxa_pobreza: {
    label: "Taxa de Pobreza",
    format: (v) => `${v.toFixed(1)}%`,
    lowerIsBetter: true,
  },
}

export const STATE_INDICATOR_ORDER = [
  "populacao_estimada",
  "pib_total",
  "taxa_desemprego",
  "taxa_pobreza",
  "homicidios_100k",
  "gini",
] as const

export function getStateIndicatorLowerIsBetter(indicador: string): boolean {
  return STATE_INDICATOR_CONFIG[indicador]?.lowerIsBetter ?? false
}

/** Ordem masculina por extenso para labels tipo "5o de 12" */
export function ordinalMasculino(n: number): string {
  return `${n}o`
}
