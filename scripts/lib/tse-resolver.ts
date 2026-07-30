import { supabase } from "./supabase"
import { normalizeForMatch } from "./normalize-for-match"
import type { CandidatoConfig } from "./types"

export type ResolveMethod = "sq-preloaded" | "cpf" | "name-unique" | "name-uf"

export interface ResolveResult {
  slug: string
  method: ResolveMethod
}

export interface ResolverStats {
  sqPreloaded: number
  cpf: number
  nameUnique: number
  nameUf: number
  ambiguous: number
  noMatch: number
}

export interface TSEResolver {
  resolveRow(row: Record<string, string>): ResolveResult | null
  stats: ResolverStats
  ambiguousSlugs: string[]
}

interface CandidatoDBRow {
  slug: string
  cpf: string | null
}

export function getResolveMethodPriority(method: ResolveMethod): number {
  switch (method) {
    case "sq-preloaded":
      return 4
    case "cpf":
      return 3
    case "name-unique":
      return 2
    case "name-uf":
      return 1
  }
}

export function isWeakNameMatch(method: ResolveMethod): boolean {
  return method === "name-unique" || method === "name-uf"
}

/**
 * Match por nome NUNCA e aceito, em ano nenhum.
 *
 * Ate 30/07/2026 isto era `shouldSkipWeakMatchForAno`, e so recusava match
 * fraco em 2024. De 2010 a 2022 um chute por nome era aceito e, no caso do
 * `persist-sq-candidato.ts`, GRAVADO em `data/candidatos.json`. Na rodada
 * seguinte esse valor voltava como `sq-preloaded`, prioridade 4, acima de
 * `cpf`, que e 3.
 *
 * Isso e lavagem de confianca: o chute entra fraco, vira ancora de confianca
 * maxima e passa a derrotar o unico sinal que poderia corrigi-lo, se
 * auto-reforcando a cada execucao. Foi o que colocou o senador do PR na ficha
 * do ex-prefeito de Natal, entre outros 15 casos, e o que levou 19 linhas de
 * patrimonio e 23 de financiamento pra quarentena em 20260730170000.
 *
 * O guard existir so pra 2024 mostrava que o risco ja tinha sido percebido e
 * tapado num ano so.
 *
 * TRADE-OFF ACEITO: sem match por nome, candidato sem SQ e sem CPF deixa de
 * ser resolvido, e a cobertura cai. E o lado certo pra errar. SQ ausente faz a
 * ingestao cair pra CPF, que e mais forte; SQ errado sequestra a ficha E ainda
 * bloqueia o CPF, porque tem prioridade maior. Num site civico, campo vazio e
 * recuperavel, atribuir o patrimonio de uma pessoa a outra nao e.
 */
export function shouldSkipWeakMatch(method: ResolveMethod): boolean {
  return isWeakNameMatch(method)
}

function normalizeCPF(value: string): string {
  const normalized = value.replace(/\D/g, "")
  return normalized.length === 11 ? normalized : ""
}

function addNameMatch(
  map: Map<string, CandidatoConfig[]>,
  name: string,
  candidato: CandidatoConfig
) {
  const normalized = normalizeForMatch(name)
  if (!normalized) return

  const existing = map.get(normalized) ?? []
  if (existing.some((item) => item.slug === candidato.slug)) {
    return
  }

  existing.push(candidato)
  map.set(normalized, existing)
}

function buildNameMap(candidatos: CandidatoConfig[]): Map<string, CandidatoConfig[]> {
  const map = new Map<string, CandidatoConfig[]>()

  for (const candidato of candidatos) {
    addNameMatch(map, candidato.nome_completo, candidato)
    addNameMatch(map, candidato.nome_urna, candidato)
  }

  return map
}

function getCandidateMatches(
  row: Record<string, string>,
  nameMap: Map<string, CandidatoConfig[]>
): CandidatoConfig[] {
  const fullName = normalizeForMatch(row.NM_CANDIDATO || "")
  const urnaName = normalizeForMatch(row.NM_URNA_CANDIDATO || "")
  const rowUf = (row.SG_UF || "").trim().toUpperCase()

  if (fullName) {
    const fullMatches = (nameMap.get(fullName) ?? []).filter(
      (candidato) => normalizeForMatch(candidato.nome_completo) === fullName
    )

    if (fullMatches.length > 0) {
      return [...new Map(fullMatches.map((candidato) => [candidato.slug, candidato])).values()]
    }
  }

  if (!urnaName) {
    return []
  }

  const urnaMatches = (nameMap.get(urnaName) ?? []).filter(
    (candidato) => normalizeForMatch(candidato.nome_urna) === urnaName
  )

  if (!rowUf) {
    return []
  }

  return urnaMatches.filter(
    (candidato) => (candidato.estado || "").trim().toUpperCase() === rowUf
  )
}

export async function createTSEResolver(
  candidatos: CandidatoConfig[],
  ano: number
): Promise<TSEResolver> {
  // Guarda a UF declarada junto com o slug: ate 2008, SQ_CANDIDATO nao e chave
  // global no TSE, e sim sequencial POR UF (valores curtos como "10354"). Sem
  // a UF aqui, um SQ curto do seed casa com a primeira linha que tiver aquele
  // numero em qualquer estado.
  const sqToCandidato = new Map<string, { slug: string; estado: string }>()
  for (const candidato of candidatos) {
    const sq = candidato.ids.tse_sq_candidato?.[String(ano)]?.trim()
    if (sq) {
      sqToCandidato.set(sq, {
        slug: candidato.slug,
        estado: (candidato.estado || "").trim().toUpperCase(),
      })
    }
  }

  const { data, error } = await supabase
    .from("candidatos")
    .select("slug, cpf")
    .in("slug", candidatos.map((candidato) => candidato.slug))

  if (error) {
    throw new Error(`Falha ao carregar CPF do Supabase: ${error.message}`)
  }

  const cpfToSlug = new Map<string, string>()
  for (const row of (data ?? []) as CandidatoDBRow[]) {
    const cpf = normalizeCPF(row.cpf || "")
    if (cpf) {
      cpfToSlug.set(cpf, row.slug)
    }
  }

  const nameMap = buildNameMap(candidatos)
  const stats: ResolverStats = {
    sqPreloaded: 0,
    cpf: 0,
    nameUnique: 0,
    nameUf: 0,
    ambiguous: 0,
    noMatch: 0,
  }
  const ambiguousSlugs = new Set<string>()

  return {
    resolveRow(row) {
      const sq = (row.SQ_CANDIDATO || "").trim()
      if (sq) {
        const candidato = sqToCandidato.get(sq)
        if (candidato) {
          // Mesma guarda de UF que o caminho por nome ja tinha, e pela mesma
          // razao. Ate 2008 o SQ e sequencial por estado, entao um SQ curto do
          // seed pode colidir com outra pessoa em outra UF, e o degrau de SQ e
          // o de MAIOR prioridade: ele nao degrada para o proximo, ancora
          // direto. Auditoria de 2026-07-26.
          const rowUfSq = (row.SG_UF || "").trim().toUpperCase()
          const ufDivergeNoSq =
            Boolean(rowUfSq) && Boolean(candidato.estado) && rowUfSq !== candidato.estado

          if (!ufDivergeNoSq) {
            stats.sqPreloaded++
            return { slug: candidato.slug, method: "sq-preloaded" }
          }
          // UF diverge: nao ancora por SQ e deixa os degraus seguintes (CPF e
          // nome, que tem guarda propria) decidirem.
        }
      }

      const cpf = normalizeCPF(row.NR_CPF_CANDIDATO || "")
      if (cpf) {
        const slug = cpfToSlug.get(cpf)
        if (slug) {
          stats.cpf++
          return { slug, method: "cpf" }
        }
      }

      const matches = getCandidateMatches(row, nameMap)
      if (matches.length === 0) {
        stats.noMatch++
        return null
      }

      if (matches.length === 1) {
        // RC4 fix: reject name-unique match if UF doesn't match candidate's state
        // This check is load-bearing for homonym prevention. Do not remove.
        const rowUf = (row.SG_UF || "").trim().toUpperCase()
        const matchUf = (matches[0].estado || "").trim().toUpperCase()
        if (rowUf && !matchUf) {
          stats.noMatch++
          return null
        }
        if (rowUf && matchUf && rowUf !== matchUf) {
          stats.noMatch++
          return null
        }
        stats.nameUnique++
        return { slug: matches[0].slug, method: "name-unique" }
      }

      const rowUf = (row.SG_UF || "").trim().toUpperCase()
      if (rowUf) {
        const ufMatches = matches.filter(
          (candidato) => (candidato.estado || "").trim().toUpperCase() === rowUf
        )

        if (ufMatches.length === 1) {
          stats.nameUf++
          return { slug: ufMatches[0].slug, method: "name-uf" }
        }

        if (ufMatches.length > 1) {
          for (const candidato of ufMatches) {
            ambiguousSlugs.add(candidato.slug)
          }
          stats.ambiguous++
          return null
        }
      }

      for (const candidato of matches) {
        ambiguousSlugs.add(candidato.slug)
      }
      stats.ambiguous++
      return null
    },
    stats,
    get ambiguousSlugs() {
      return [...ambiguousSlugs]
    },
  }
}
