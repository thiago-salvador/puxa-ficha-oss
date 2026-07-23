import type { IndicadorEstadual } from "@/lib/types"
import { STATE_INDICATOR_CONFIG } from "@/lib/state-indicator-metadata"
import type { StateRankingResult } from "@/lib/state-ranking"

function pctChange(prev: number, latest: number): number {
  if (prev === 0) return latest === 0 ? 0 : 100
  return ((latest - prev) / Math.abs(prev)) * 100
}

type RankRow = StateRankingResult["rankings"][0]

function groupIndicatorsByName(indicadoresUf: IndicadorEstadual[]): Map<string, IndicadorEstadual[]> {
  const byInd = new Map<string, IndicadorEstadual[]>()
  for (const row of indicadoresUf) {
    if (row.valor == null) continue
    const list = byInd.get(row.indicador) ?? []
    list.push(row)
    byInd.set(row.indicador, list)
  }
  for (const [, list] of byInd) {
    list.sort((a, b) => b.ano - a.ano)
  }
  return byInd
}

function isTopFive(row: RankRow): boolean {
  return row.posicao <= 5 && row.total >= 5
}

function isBottomFive(row: RankRow): boolean {
  return row.total >= 5 && row.posicao > row.total - 5
}

function sortRankingsByExtreme(rankings: RankRow[]): RankRow[] {
  return [...rankings].sort((a, b) => {
    const aBad = isBottomFive(a)
    const bBad = isBottomFive(b)
    const aGood = isTopFive(a)
    const bGood = isTopFive(b)
    if (aBad !== bBad) return aBad ? -1 : 1
    if (aGood !== bGood) return aGood ? -1 : 1
    return a.posicao - b.posicao
  })
}

function extremeSentence(row: RankRow, estadoNome: string): string | null {
  const cfg = STATE_INDICATOR_CONFIG[row.indicador]
  if (!cfg) return null
  const formatted = cfg.format(row.valor)
  const mediaFmt = cfg.format(row.mediaNacional)

  if (isTopFive(row)) {
    return `${estadoNome} aparece entre os estados com melhor desempenho em ${cfg.label.toLowerCase()}: ${formatted} (${row.label}, ano ${row.ano}), enquanto a media nacional situa em ${mediaFmt}.`
  }

  if (isBottomFive(row)) {
    return `Em ${cfg.label.toLowerCase()}, ${estadoNome} esta entre os piores do pais (${formatted}, ${row.label}, ano ${row.ano}). A media nacional e ${mediaFmt}.`
  }

  return null
}

type TrendCandidate = { indicador: string; phrase: string; absPct: number }

function buildTrendCandidate(
  indicador: string,
  list: IndicadorEstadual[],
): TrendCandidate | null {
  if (list.length < 2) return null
  const latest = list[0]
  const previous = list[1]
  if (latest.valor == null || previous.valor == null) return null
  const pct = pctChange(previous.valor, latest.valor)
  if (Math.abs(pct) < 10) return null
  const cfg = STATE_INDICATOR_CONFIG[indicador]
  if (!cfg) return null
  const dir = pct > 0 ? "subiu" : "caiu"
  const goodMove = cfg.lowerIsBetter ? pct < 0 : pct > 0
  const nuance = goodMove ? "movimento favorável" : "movimento que merece atenção"
  return {
    indicador,
    absPct: Math.abs(pct),
    phrase: `${cfg.label} ${dir} ${Math.abs(pct).toFixed(1)}% entre ${previous.ano} e ${latest.ano} (${nuance}).`,
  }
}

function buildTrendCandidates(
  byInd: Map<string, IndicadorEstadual[]>,
  used: Set<string>,
): TrendCandidate[] {
  const candidates: TrendCandidate[] = []
  for (const [indicador, list] of byInd) {
    if (used.has(indicador)) continue
    const candidate = buildTrendCandidate(indicador, list)
    if (candidate) candidates.push(candidate)
  }
  return candidates.sort((a, b) => b.absPct - a.absPct)
}

function fallbackSentence(ranking: StateRankingResult, estadoNome: string): string | null {
  if (ranking.rankings.length === 0) return null
  const row = ranking.rankings.reduce((best, cur) =>
    cur.posicao < best.posicao ? cur : best
  )
  const cfg = STATE_INDICATOR_CONFIG[row.indicador]
  if (!cfg) return null
  return `${estadoNome} registra ${cfg.label.toLowerCase()} em ${cfg.format(row.valor)} (${row.label}, ${row.ano}), proximo da media nacional (${cfg.format(row.mediaNacional)}).`
}

/**
 * Até 3 frases editoriais determinísticas a partir de ranking e série temporal da UF.
 */
export function buildStateNarrative(
  ranking: StateRankingResult,
  estadoNome: string,
  indicadoresUf: IndicadorEstadual[]
): string[] {
  const sentences: string[] = []
  const used = new Set<string>()
  const byInd = groupIndicatorsByName(indicadoresUf)
  const sortedByExtreme = sortRankingsByExtreme(ranking.rankings)

  const pushExtreme = (r: RankRow) => {
    if (sentences.length >= 3 || used.has(r.indicador)) return
    const phrase = extremeSentence(r, estadoNome)
    if (!phrase) return
    sentences.push(phrase)
    used.add(r.indicador)
  }

  for (const r of sortedByExtreme) {
    pushExtreme(r)
    if (sentences.length >= 3) break
  }

  for (const t of buildTrendCandidates(byInd, used)) {
    if (sentences.length >= 3) break
    if (used.has(t.indicador)) continue
    sentences.push(t.phrase)
    used.add(t.indicador)
  }

  if (sentences.length === 0 && ranking.rankings.length > 0) {
    const phrase = fallbackSentence(ranking, estadoNome)
    if (phrase) sentences.push(phrase)
  }

  return sentences.slice(0, 3)
}
