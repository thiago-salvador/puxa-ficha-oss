import type { SupabaseClient } from "@supabase/supabase-js"

import { sumTotalGastoByCandidatoId } from "@/lib/gastos-parlamentares-aggregate"
import type { LegislacaoMandatoExecutivo, MudancaPartido } from "@/lib/types"
import { countVotosRowsByCandidatoId } from "@/lib/votos-candidato-aggregate"

/** PostgREST / Supabase default max rows per request. */
const PAGE_SIZE = 1000
/** Smaller public LME pages avoid statement timeouts on 3k+ inventories during parallel SSG. */
const LEGISLACAO_MANDATO_EXECUTIVO_PAGE_SIZE = 250

/** Keep `.in()` lists bounded for URL size and planner stability. */
const CANDIDATO_ID_CHUNK = 100

export const LEGISLACAO_MANDATO_EXECUTIVO_PUBLIC_SELECT =
  "id,candidato_id,tipo_relacao,tipo_norma,numero,ano,data_norma,ementa,signatario,autoridade_papel,fonte_primaria_url,metadata" as const

type GastoRow = { candidato_id: string; total_gasto: number | string | null }
type VotoRow = { candidato_id: string }

/**
 * Soma `total_gasto` por candidato, percorrendo todas as páginas de resultado.
 * Evita truncamento em 1000 linhas quando há muitos registros de gastos.
 */
export async function fetchGastoTotalsByCandidatoIds(
  supabase: SupabaseClient,
  candidatoIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(candidatoIds)].filter(Boolean)
  if (ids.length === 0) {
    return new Map()
  }

  const all: GastoRow[] = []

  for (let c = 0; c < ids.length; c += CANDIDATO_ID_CHUNK) {
    const idChunk = ids.slice(c, c + CANDIDATO_ID_CHUNK)
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from("gastos_parlamentares")
        .select("candidato_id,total_gasto")
        .in("candidato_id", idChunk)
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        throw new Error(`gastos_parlamentares batch: ${error.message}`)
      }

      const rows = (data ?? []) as GastoRow[]
      all.push(...rows)
      if (rows.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }

  return sumTotalGastoByCandidatoId(all)
}

/**
 * Conta linhas de `votos_candidato` por candidato com paginação completa.
 */
export async function fetchVotosCountsByCandidatoIds(
  supabase: SupabaseClient,
  candidatoIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(candidatoIds)].filter(Boolean)
  if (ids.length === 0) {
    return new Map()
  }

  const all: VotoRow[] = []

  for (let c = 0; c < ids.length; c += CANDIDATO_ID_CHUNK) {
    const idChunk = ids.slice(c, c + CANDIDATO_ID_CHUNK)
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from("votos_candidato")
        .select("candidato_id")
        .in("candidato_id", idChunk)
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        throw new Error(`votos_candidato batch: ${error.message}`)
      }

      const rows = (data ?? []) as VotoRow[]
      all.push(...rows)
      if (rows.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }

  return countVotosRowsByCandidatoId(all)
}

const MUDANCAS_SELECT =
  "id,candidato_id,ano,partido_anterior,partido_novo,data_mudanca,contexto" as const

/** Todas as linhas de `mudancas_partido` para os candidatos (paginado). */
export async function fetchMudancasPartidoRowsPaged(
  supabase: SupabaseClient,
  candidatoIds: string[]
): Promise<MudancaPartido[]> {
  const ids = [...new Set(candidatoIds)].filter(Boolean)
  if (ids.length === 0) {
    return []
  }

  const all: MudancaPartido[] = []

  for (let c = 0; c < ids.length; c += CANDIDATO_ID_CHUNK) {
    const idChunk = ids.slice(c, c + CANDIDATO_ID_CHUNK)
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from("mudancas_partido")
        .select(MUDANCAS_SELECT)
        .in("candidato_id", idChunk)
        .order("ano", { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        throw new Error(`mudancas_partido batch: ${error.message}`)
      }

      const rows = (data ?? []) as MudancaPartido[]
      all.push(...rows)
      if (rows.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }

  return all
}

/**
 * Linhas publicas de `legislacao_mandato_executivo` para uma ficha, sem truncar no limite default de 1000.
 * Ingest/readback de curadoria deve consultar a tabela diretamente quando precisar de campos DB-only.
 */
export async function fetchLegislacaoMandatoExecutivoRowsPaged(
  supabase: SupabaseClient,
  candidatoId: string
): Promise<LegislacaoMandatoExecutivo[]> {
  if (!candidatoId) {
    return []
  }

  const all: LegislacaoMandatoExecutivo[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from("legislacao_mandato_executivo")
      .select(LEGISLACAO_MANDATO_EXECUTIVO_PUBLIC_SELECT)
      .eq("candidato_id", candidatoId)
      .range(from, from + LEGISLACAO_MANDATO_EXECUTIVO_PAGE_SIZE - 1)

    if (error) {
      throw new Error(`legislacao_mandato_executivo batch: ${error.message}`)
    }

    const rows = (data ?? []) as LegislacaoMandatoExecutivo[]
    all.push(...rows)
    if (rows.length < LEGISLACAO_MANDATO_EXECUTIVO_PAGE_SIZE) break
    from += LEGISLACAO_MANDATO_EXECUTIVO_PAGE_SIZE
  }

  return all
}
