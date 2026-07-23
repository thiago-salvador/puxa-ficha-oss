/**
 * Configuração versionada para lotes `financiamento-gap` (ingest só financiamento, sem patrimônio).
 */

export type FinanciamentoGapLoteJson = {
  version?: number
  lote_id?: string
  description?: string
  /** Anos TSE a processar; omitido ou vazio → `DEFAULT_ANOS_DINHEIRO` no caller. */
  anos?: number[] | null
  slugs: string[]
}

export function parseFinanciamentoGapLoteJson(raw: string): FinanciamentoGapLoteJson {
  const j = JSON.parse(raw) as FinanciamentoGapLoteJson
  if (!Array.isArray(j.slugs)) throw new Error("Campo `slugs` deve ser um array.")
  return j
}

export function normalizedFinanciamentoGapSlugs(j: FinanciamentoGapLoteJson): string[] {
  return [...new Set(j.slugs.map((s) => String(s).trim()).filter(Boolean))]
}
