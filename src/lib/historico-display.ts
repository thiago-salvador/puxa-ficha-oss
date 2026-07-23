import { canonicalCargo } from "@/lib/cargo-utils"
import { isHistoricoCandidaturaRow } from "@/lib/historico-tipo-evento"
import type { HistoricoPolitico } from "@/lib/types"

const CURRENT_UNDECIDED_ELECTION_YEAR = 2026

function normalizeObservation(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function isCurrentUndecidedCandidatura(
  item: Pick<
    HistoricoPolitico,
    "tipo_evento" | "periodo_inicio" | "periodo_fim" | "observacoes"
  >,
): boolean {
  const year = item.periodo_inicio ?? item.periodo_fim
  return (
    year != null &&
    year >= CURRENT_UNDECIDED_ELECTION_YEAR &&
    isHistoricoCandidaturaRow(item)
  )
}

function formatCurrentUndecidedCandidaturaLabel(
  item: Pick<HistoricoPolitico, "observacoes">,
): string {
  const obs = normalizeObservation(item.observacoes)
  return obs.includes("pre-candidatura") || obs.includes("pre-candidato")
    ? "Pré-candidato"
    : "Candidato"
}

/** Chave alinhada a dedupe / ingest (`cargo_canonico` ou `canonicalCargo`). */
export function historicoCanonKey(
  item: Pick<HistoricoPolitico, "cargo" | "cargo_canonico">,
): string {
  return (item.cargo_canonico?.trim() || canonicalCargo(item.cargo ?? "")).trim()
}

/**
 * Vários registos do mesmo cargo com `periodo_fim` nulo: só o de maior `periodo_inicio` é
 * tratado como mandato em curso; os outros são dados abertos obsoletos (falta `periodo_fim`).
 */
export function isHistoricoOpenStale(
  item: Pick<
    HistoricoPolitico,
    "periodo_inicio" | "periodo_fim" | "cargo" | "cargo_canonico"
  >,
  all: HistoricoPolitico[],
): boolean {
  if (item.periodo_fim != null || item.periodo_inicio == null) return false
  const canon = historicoCanonKey(item)
  const openWithInicio = all.filter(
    (h) => historicoCanonKey(h) === canon && h.periodo_fim == null && h.periodo_inicio != null,
  )
  if (openWithInicio.length <= 1) return false
  const maxOpenInicio = Math.max(...openWithInicio.map((h) => h.periodo_inicio ?? 0))
  return (item.periodo_inicio ?? 0) < maxOpenInicio
}

/**
 * Quando um registo aberto é "obsoleto" (há outro aberto mais recente no mesmo cargo),
 * infere o ano de fim como o ano anterior ao `periodo_inicio` do mandato seguinte
 * (qualquer registo do mesmo cargo canónico com início maior), p.ex. 2002 → 2010 se o
 * próximo Presidente na lista começa em 2011.
 */
export function inferStaleOpenEndYear(
  item: Pick<HistoricoPolitico, "id" | "periodo_inicio" | "periodo_fim" | "cargo" | "cargo_canonico">,
  all: HistoricoPolitico[],
): number | null {
  if (!isHistoricoOpenStale(item, all) || item.periodo_inicio == null) return null
  const canon = historicoCanonKey(item)
  const ini = item.periodo_inicio

  const sameStartClosed = all.filter(
    (h) =>
      h.id !== item.id &&
      historicoCanonKey(h) === canon &&
      h.periodo_inicio === ini &&
      h.periodo_fim != null,
  )
  if (sameStartClosed.length > 0) {
    const mf = Math.max(...sameStartClosed.map((h) => h.periodo_fim!))
    if (mf >= ini) return mf
  }

  const later = all.filter(
    (h) =>
      h.id !== item.id &&
      historicoCanonKey(h) === canon &&
      h.periodo_inicio != null &&
      h.periodo_inicio > ini,
  )
  if (later.length === 0) return null
  const nextStart = Math.min(...later.map((h) => h.periodo_inicio!))
  const diff = nextStart - ini
  // Não esticar um mandato até um retorno muito posterior (ex.: 2002→2022) sem dados intermédios.
  if (diff >= 16) return null
  // Mandatos consecutivos no mesmo ciclo eleitoral brasileiro (4 anos): fim = ano do próximo início.
  const end = diff === 4 || diff === 8 ? nextStart : nextStart - 1
  return end >= ini ? end : null
}

/**
 * Período para UI: quando há mais de um registo do mesmo cargo com `periodo_fim` nulo,
 * só o de maior `periodo_inicio` pode ser tratado como "atual" (evita dois "atual" na ficha).
 */
export function formatHistoricoPeriodoDisplay(
  item: Pick<
    HistoricoPolitico,
    | "id"
    | "periodo_inicio"
    | "periodo_fim"
    | "observacoes"
    | "cargo"
    | "cargo_canonico"
    | "tipo_evento"
  >,
  all: HistoricoPolitico[],
): string {
  if (isCurrentUndecidedCandidatura(item)) {
    return formatCurrentUndecidedCandidaturaLabel(item)
  }

  if (item.periodo_inicio != null && item.periodo_fim != null) {
    if (item.periodo_inicio === item.periodo_fim) {
      const isTseCandidatura = item.observacoes?.toLowerCase().includes("tse")
      return isTseCandidatura
        ? `${item.periodo_inicio} - Não Eleito`
        : `${item.periodo_inicio}`
    }
    return `${item.periodo_inicio} - ${item.periodo_fim}`
  }

  if (item.periodo_inicio != null && item.periodo_fim == null) {
    if (isHistoricoOpenStale(item, all)) {
      const inferred = inferStaleOpenEndYear(item, all)
      if (inferred != null) {
        return `${item.periodo_inicio} - ${inferred}`
      }
      return `${item.periodo_inicio} - mandato encerrado`
    }

    return `${item.periodo_inicio} - atual`
  }

  if (item.periodo_fim != null) {
    return `Até ${item.periodo_fim}`
  }

  return "Período não determinado"
}

/** Mesma convenção do overview e da aba Trajetória (`prepareHistoricoPoliticoPublicDisplayList` em `trajetoria-public-display.ts`). */
export function formatHistoricoPartidoEstadoLine(
  item: Pick<HistoricoPolitico, "partido" | "estado">,
): string {
  const left = item.partido?.trim() ?? ""
  const right = item.estado?.trim() ? `(${item.estado.trim()})` : ""
  return [left, right].filter(Boolean).join(" ").trim()
}

/** Oculta prefixo interno "Candidatura:" (igual `TrajectoryTabSection`). */
export function formatHistoricoObservacaoPublica(obs: string | null | undefined): string | null {
  if (!obs) return null
  if (obs.startsWith("Candidatura:")) return null
  return obs
}

/** Título do cargo na ficha: distingue pleito (candidatura) de mandato. */
export function formatHistoricoCargoTituloPublico(
  item: Pick<
    HistoricoPolitico,
    "cargo" | "tipo_evento" | "observacoes" | "periodo_inicio" | "periodo_fim"
  >,
): string {
  return isHistoricoCandidaturaRow(item) ? `Candidatura: ${item.cargo}` : item.cargo
}
