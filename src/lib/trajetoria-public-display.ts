/**
 * Contrato único de ordenação e contagens públicas da trajetória na ficha
 * (overview + aba Trajetória + timeline), após `normalizeHistoricoPoliticoForDisplay`
 * em `src/lib/api.ts`.
 *
 * Ver `curadoria interna` (Fluxo 2; linhas vs trocas efetivas).
 */

import { normalizeHistoricoPoliticoForDisplay } from "@/lib/historico-dedupe"
import type { HistoricoPolitico, MudancaPartido } from "@/lib/types"

/** Ordenação decrescente por `periodo_inicio` (overview e lista completa na aba). */
function compareHistoricoPoliticoPublicDisplay(
  a: Pick<HistoricoPolitico, "periodo_inicio">,
  b: Pick<HistoricoPolitico, "periodo_inicio">,
): number {
  return (b.periodo_inicio ?? 0) - (a.periodo_inicio ?? 0)
}

/**
 * Lista já normalizada (`FichaCandidato.historico`) na ordem pública canónica.
 * Não re-aplica dedupe; a fonte única de dedupe continua a ser `normalizeHistoricoPoliticoForDisplay`.
 */
export function prepareHistoricoPoliticoPublicDisplayList(
  historicoNormalizado: HistoricoPolitico[],
): HistoricoPolitico[] {
  return [...historicoNormalizado].sort(compareHistoricoPoliticoPublicDisplay)
}

/**
 * Pipeline completo para superfícies que podem receber dados crus (ex.: timeline agregada).
 */
export function buildPublicHistoricoPoliticoDisplayListFromRaw(
  historico: HistoricoPolitico[],
): HistoricoPolitico[] {
  return prepareHistoricoPoliticoPublicDisplayList(normalizeHistoricoPoliticoForDisplay(historico))
}

/**
 * Contagem bruta de linhas na timeline partidária **após** normalização da API
 * (`normalizePartyTimelineForDisplay` + ordenação em `api.ts`), alinhada a
 * `mudancas_partido_linhas` nos snapshots factuais — **não** é `countPartySwitches`.
 */
export function mudancasPartidoLinhasPublicas(mudancasNormalizadas: readonly MudancaPartido[]): number {
  return mudancasNormalizadas.length
}

/**
 * Badge numérico do separador "Trajetória" no `ProfileTabs`: soma de registos de
 * cargos/mandatos (`historico`) e de linhas da timeline partidária (`mudancas`),
 * ambos já normalizados na `FichaCandidato`. Indica volume de conteúdo da aba;
 * é distinto de `mudancasPartidoLinhasPublicas` (só partidos) e de trocas efetivas.
 */
export function profileTrajetoriaTabBadgeCount(
  historicoNormalizado: readonly HistoricoPolitico[],
  mudancasNormalizadas: readonly MudancaPartido[],
): number {
  return historicoNormalizado.length + mudancasNormalizadas.length
}
