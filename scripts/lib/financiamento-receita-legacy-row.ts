/**
 * Prestações de receitas TSE 2010–2016 (e parciais) usam cabeçalhos em português;
 * 2018+ tende a usar nomes como SQ_CANDIDATO / VR_RECEITA. Unifica para o ingest.
 */
function firstNonEmpty(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

export function normalizeFinanciamentoReceitaRow(row: Record<string, string>): Record<string, string> {
  const sqCand = firstNonEmpty(row, ["SQ_CANDIDATO", "Sequencial Candidato"])
  const sqRec = firstNonEmpty(row, [
    "SQ_RECEITA",
    "Numero Recibo Eleitoral",
    "Número Recibo Eleitoral",
    "Numero do documento",
    "Número do documento",
  ])
  const vr = firstNonEmpty(row, ["VR_RECEITA", "Valor receita"])
  const tipo = firstNonEmpty(row, ["Tipo receita"])
  const desc = firstNonEmpty(row, ["Descricao da receita", "Descrição da receita"])
  const origemPadrao = firstNonEmpty(row, ["DS_ORIGEM_RECEITA"])
  const dsOrigem = [origemPadrao, tipo, desc].filter(Boolean).join(" — ")
  const nm = firstNonEmpty(row, ["NM_DOADOR", "Nome do doador"])
  const nmRfb = firstNonEmpty(row, ["NM_DOADOR_RFB", "Nome do doador RFB"])

  return {
    ...row,
    SQ_CANDIDATO: sqCand || row.SQ_CANDIDATO,
    SQ_RECEITA: sqRec || row.SQ_RECEITA,
    VR_RECEITA: vr || row.VR_RECEITA,
    DS_ORIGEM_RECEITA: dsOrigem || row.DS_ORIGEM_RECEITA,
    NM_DOADOR: nm || row.NM_DOADOR,
    NM_DOADOR_RFB: nmRfb || row.NM_DOADOR_RFB,
  }
}
