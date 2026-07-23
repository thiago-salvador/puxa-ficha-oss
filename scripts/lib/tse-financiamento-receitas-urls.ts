/**
 * URLs oficiais (CDN TSE) dos ZIPs de receitas de candidatos por ano de eleição.
 *
 * Evidência (HEAD HTTP 200 vs 404) e catálogo público:
 * - 2018+: `prestacao_de_contas_eleitorais_candidatos_<ano>.zip` — OK a partir de 2018.
 * - 2016 e 2010: `prestacao_contas_<ano>.zip` — OK (o nome `prestacao_de_contas_eleitorais_candidatos_*` devolve 404).
 * - 2012 e 2014: vários ficheiros no Portal de Dados Abertos (`prestacao_final_*`, `primeira_parcial_*`, `segunda_parcial_*`) — OK; o pacote único `prestacao_de_contas_eleitorais_candidatos_*` devolve 404.
 *
 * Referências: `https://dadosabertos.tse.jus.br/dataset/prestacao-de-contas-eleitorais-2010` (e homólogos 2012/2014).
 */
const PRESTACAO_CONTAS_BASE =
  "https://cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas"

export function financiamentoReceitasZipUrls(ano: number): string[] {
  if (ano >= 2018) {
    return [`${PRESTACAO_CONTAS_BASE}/prestacao_de_contas_eleitorais_candidatos_${ano}.zip`]
  }
  if (ano === 2016 || ano === 2010) {
    return [`${PRESTACAO_CONTAS_BASE}/prestacao_contas_${ano}.zip`]
  }
  if (ano === 2012) {
    return [
      `${PRESTACAO_CONTAS_BASE}/primeira_parcial_2012.zip`,
      `${PRESTACAO_CONTAS_BASE}/segunda_parcial_2012.zip`,
      `${PRESTACAO_CONTAS_BASE}/prestacao_final_2012.zip`,
    ]
  }
  if (ano === 2014) {
    return [
      `${PRESTACAO_CONTAS_BASE}/primeira_parcial_2014.zip`,
      `${PRESTACAO_CONTAS_BASE}/segunda_parcial_2014.zip`,
      `${PRESTACAO_CONTAS_BASE}/prestacao_final_2014.zip`,
    ]
  }
  return [`${PRESTACAO_CONTAS_BASE}/prestacao_de_contas_eleitorais_candidatos_${ano}.zip`]
}
