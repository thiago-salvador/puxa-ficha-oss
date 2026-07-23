import "server-only"
import { cache } from "react"
import { unstable_cache, unstable_noStore as noStore } from "next/cache"
import { headers } from "next/headers"
import { collectQuizVotacaoTitulos, QUIZ_PERGUNTAS } from "@/data/quiz/perguntas"
import {
  buildFinanciamentoContexto,
  buildFinanciamentoDoacaoPerfil,
  type QuizFinanciamentoDoacaoPerfil,
} from "@/lib/quiz-financiamento"
import {
  createServerSupabaseClient,
  createServiceRoleSupabaseClient,
  getAppSupabaseUrl,
} from "./supabase"
import { isSupabaseNoRowError } from "./supabase-errors"
import { normalizeVotoFromApi } from "@/lib/quiz-scoring"
import type {
  QuizAlignmentDataset,
  QuizCandidatoData,
  QuizContradicaoVoto,
  QuizPosicaoDeclarada,
} from "@/lib/quiz-types"
import type {
  Candidato,
  FichaCandidato,
  CandidatoComparavel,
  IndicadorEstadual,
  IndicadorEstadualRanking,
  DataResource,
  Financiamento,
  GastoParlamentar,
  HistoricoPolitico,
  LegislacaoMandatoExecutivo,
  MudancaPartido,
  Patrimonio,
  ProjetoLei,
  SectionFreshnessInfo,
  SectionFreshnessKey,
  VotoCandidato,
} from "./types"
import {
  buildGlobalSearchIndexItems,
  mergeVotacaoTagsByCandidatoId,
  type GlobalSearchIndexItem,
  type VotacaoSearchRow,
} from "@/lib/global-search"
import { countPartySwitches, normalizePartyTimelineForDisplay } from "@/lib/party-switches"
import {
  fetchGastoTotalsByCandidatoIds,
  fetchLegislacaoMandatoExecutivoRowsPaged,
  fetchMudancasPartidoRowsPaged,
  fetchVotosCountsByCandidatoIds,
} from "@/lib/fetch-gastos-votos-in-batch"
import { applyLegislacaoMandatoExecutivoCachePolicy } from "@/lib/legislacao-mandato-executivo-cache"
import { sortVotosForPublicDisplay } from "@/lib/votos-candidato-aggregate"
import {
  hasIncompletePartyTimeline,
} from "@/lib/candidate-integrity"
import { isHistoricoCandidaturaRow } from "@/lib/historico-tipo-evento"
import { normalizeHistoricoPoliticoForDisplay } from "@/lib/historico-dedupe"
import {
  normalizeFinanciamentoForDisplay,
  normalizePatrimonioForDisplay,
} from "@/lib/person-level-dedupe"
import {
  sanitizeFinanciamentoForPublic,
  sanitizeMaioresDoadoresForPublic,
} from "@/lib/financiamento-public"
import { isPublicAttentionPoint } from "@/lib/public-attention-point"
import {
  sanitizePublicPartyFields,
  sanitizePublicPartyFieldsList,
} from "@/lib/public-candidate-sanitize"
import {
  classifyAttentionPoints,
  isNegativeHighestSeverityAttentionPoint,
} from "@/lib/attention-points"
import { withSupabaseRetry } from "@/lib/supabase-retry"
import { getCanonicalPerson } from "@/lib/canonical-person-map"
import { formatDate } from "@/lib/utils"
import { buildVotacaoPublicUrl } from "@/lib/quiz-votacao-url"
import { getRankingDefinitionBySlug } from "@/data/ranking-definitions"
import {
  buildAggregateRankingEntries,
  buildFieldRankingEntries,
  normalizeRankingFilters,
  sortRankingEntries,
  type RankingCandidateSummary,
  type RankingDataset,
  type RankingDefinition,
  type RankingEntry,
  type RankingFieldCandidate,
} from "@/lib/rankings"
import {
  degradedResource,
  liveResource,
  mergeSourceMessages,
  mergeSourceStatuses,
} from "@/lib/data-resource"

export { mergeSourceMessages, mergeSourceStatuses } from "@/lib/data-resource"

const supabaseUrl = getAppSupabaseUrl()
const USE_MOCK = !supabaseUrl || supabaseUrl.includes("placeholder")
const IS_DEV = process.env.NODE_ENV === "development"
const IS_LAUNCH_PHASE = process.env.PF_CURATION_PHASE === "launched"
/** Mensagem quando não há Supabase: não servimos números ou datas sintéticos na API pública. */
const SUPABASE_REQUIRED_MESSAGE =
  "Configure SUPABASE_URL (sem placeholder) e SUPABASE_ANON_KEY em .env.local. O site não exibe dados mock."
const CANDIDATO_PUBLIC_RELATION = "candidatos_publico"
const APP_DATA_REVALIDATE_SECONDS = 3600
const PROFILE_FRESHNESS_WINDOW_DAYS = 30
if (USE_MOCK && process.env.VERCEL) {
  throw new Error(
    "Na Vercel é obrigatório Supabase real (SUPABASE_URL sem placeholder e SUPABASE_ANON_KEY). Previews e produção não servem dados mock."
  )
}

// Public columns only: excludes cpf, email_campanha, cpf_hash, tcu flags, wikidata_id
const CANDIDATO_COLUMNS = "id, nome_completo, nome_urna, slug, data_nascimento, idade, naturalidade, formacao, profissao_declarada, genero, estado_civil, cor_raca, partido_atual, partido_sigla, cargo_atual, cargo_disputado, estado, status, situacao_candidatura, biografia, foto_url, site_campanha, redes_sociais, fonte_dados, ultima_atualizacao"

/** Rejeições do loader não podem virar um 503 persistente no Data Cache. */
function requireLiveResourceForCache<T>(resource: DataResource<T>): DataResource<T> {
  if (resource.sourceStatus !== "live") {
    throw new Error("degraded resource must not enter the public data cache")
  }
  return resource
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function ageInDays(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
}

function buildFreshnessInfo(
  key: SectionFreshnessKey,
  label: string,
  status: SectionFreshnessInfo["status"],
  message: string,
  referenceDate: string | null = null,
  referenceYear: number | null = null,
  verifiedAt: string | null = null,
  sourceLabel: string | null = null
): SectionFreshnessInfo {
  return {
    key,
    label,
    status,
    verifiedAt,
    referenceDate,
    referenceYear,
    sourceLabel,
    message,
  }
}

function rankMudancaPartido(item: Pick<MudancaPartido, "data_mudanca" | "ano">): number {
  if (item.data_mudanca) {
    const parsed = Date.parse(item.data_mudanca)
    if (Number.isFinite(parsed)) return parsed
  }
  if (item.ano != null) {
    return Date.UTC(item.ano, 11, 31)
  }
  return 0
}

// Mapper publico do payload LME serializado em unstable_cache.
//
// Reduzido em 2026-05-01 para manter o payload de unstable_cache abaixo do
// limite de 2 MB do Vercel Data Cache. Build warning observado em 25202862956
// (Auditoria factual @ 55a40c5):
//   "Failed to set Next.js data cache for unstable_cache /candidato/[slug]
//    ..., items over 2MB can not be cached (2971512 bytes)"
// Slug de pior caso conhecido: romeu-zema (2548 LME rows, 3.21 MB cru).
//
// Campos zerados/anulados aqui (sem regressao de UI/UX porque NAO sao lidos
// por src/components/CandidatoProfileSections.tsx nem por outros consumidores
// do payload publico):
//   - candidato_id, historico_politico_id, created_at: identificadores
//     internos / timestamp de servidor; UI usa apenas `lei.id` para timeline-ref.
//   - fonte_primaria_titulo, fonte_tramitacao_url, identificador_fonte: a UI
//     renderiza apenas `fonte_primaria_url` como link "Fonte oficial".
//   - metadata.{coverage_label,case_id,source,data_real,fluxo}: a UI consome
//     apenas `metadata.coverage_id` em legislacao-profile-groups
//     (whitelist COMPLETE_EXECUTIVE_LEGISLATION_COVERAGE).
// Mantidos: id (timeline-ref), tipo_relacao/esfera/uf_norma/tipo_norma/numero/ano/
// data_norma/ementa/signatario/autoridade_papel/fonte_primaria_url, e
// metadata.coverage_id.
//
// O contrato de tipo (LegislacaoMandatoExecutivo) e' preservado: campos string
// nao-nullable recebem "" e campos nullable recebem null. Consumidores UI nao
// usam essas propriedades; consumidores de DB ingest leem direto do banco
// (nao deste mapper publico).
function toPublicLegislacaoMandatoExecutivoRow(
  row: LegislacaoMandatoExecutivo
): LegislacaoMandatoExecutivo {
  const metadata = row.metadata ?? {}
  const publicMetadata: Record<string, unknown> = {}
  if (metadata["coverage_id"] !== undefined) {
    publicMetadata["coverage_id"] = metadata["coverage_id"]
  }

  return {
    id: row.id,
    candidato_id: "",
    historico_politico_id: null,
    tipo_relacao: row.tipo_relacao,
    esfera: row.esfera,
    uf_norma: row.uf_norma,
    municipio_norma: row.municipio_norma,
    tipo_norma: row.tipo_norma,
    numero: row.numero,
    ano: row.ano,
    data_norma: row.data_norma,
    ementa: row.ementa,
    signatario: row.signatario,
    autoridade_papel: row.autoridade_papel,
    fonte_primaria_url: row.fonte_primaria_url,
    fonte_primaria_titulo: null,
    fonte_tramitacao_url: null,
    identificador_fonte: null,
    metadata: publicMetadata,
    created_at: "",
  }
}

function buildSectionFreshness(
  candidato: Candidato,
  data: {
    historico: HistoricoPolitico[]
    mudancas: MudancaPartido[]
    patrimonio: Patrimonio[]
    financiamento: Financiamento[]
    votos: VotoCandidato[]
    projetos: ProjetoLei[]
    gastos: GastoParlamentar[]
    historicoEmRevisao?: boolean
    timelinePartidariaIncompleta?: boolean
  }
): Partial<Record<SectionFreshnessKey, SectionFreshnessInfo>> {
  const updatedAt = parseDate(candidato.ultima_atualizacao)
  const latestHistoricoYear =
    data.historico.length > 0
      ? Math.max(
          ...data.historico.map((item) =>
            item.periodo_fim ?? item.periodo_inicio ?? 0
          )
        )
      : null
  const latestHistoricoRows =
    latestHistoricoYear != null
      ? data.historico.filter(
          (item) =>
            (item.periodo_fim ?? item.periodo_inicio ?? 0) ===
            latestHistoricoYear
        )
      : []
  const latestHistoricoOnlyCandidaturas =
    latestHistoricoRows.length > 0 &&
    latestHistoricoRows.every((item) => isHistoricoCandidaturaRow(item))
  const historicoFreshnessMessage =
    latestHistoricoYear != null
      ? latestHistoricoOnlyCandidaturas
        ? `Última candidatura estruturada em ${latestHistoricoYear}.`
        : `Último cargo estruturado até ${latestHistoricoYear}.`
      : null
  const latestMudancaYear =
    data.mudancas.length > 0
      ? Math.max(...data.mudancas.map((item) => item.ano ?? 0))
      : null
  const latestPatrimonioYear =
    data.patrimonio.length > 0
      ? Math.max(...data.patrimonio.map((item) => item.ano_eleicao ?? 0))
      : null
  const latestFinanciamentoYear =
    data.financiamento.length > 0
      ? Math.max(...data.financiamento.map((item) => item.ano_eleicao ?? 0))
      : null
  const latestProjetoYear =
    data.projetos.length > 0
      ? Math.max(...data.projetos.map((item) => item.ano ?? 0))
      : null
  const latestGastoYear =
    data.gastos.length > 0
      ? Math.max(...data.gastos.map((item) => item.ano ?? 0))
      : null
  const latestVoteDateString = [...data.votos]
    .map((item) => item.votacao?.data_votacao ?? null)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null
  const latestVoteDate = parseDate(latestVoteDateString)

  return {
    perfil_atual: updatedAt
      ? buildFreshnessInfo(
          "perfil_atual",
          "Perfil atual",
          !IS_LAUNCH_PHASE || ageInDays(updatedAt) <= PROFILE_FRESHNESS_WINDOW_DAYS ? "current" : "stale",
          !IS_LAUNCH_PHASE || ageInDays(updatedAt) <= PROFILE_FRESHNESS_WINDOW_DAYS
            ? `Perfil atual consolidado em ${formatDate(updatedAt)}.`
            : `Perfil atual consolidado em ${formatDate(updatedAt)}. Revalide este bloco antes de tratá-lo como atual.`,
          updatedAt.toISOString(),
          updatedAt.getFullYear(),
          updatedAt.toISOString(),
          "Perfil factual curado"
        )
      : buildFreshnessInfo(
          "perfil_atual",
          "Perfil atual",
          "missing",
          "Sem data confiável de atualização do perfil atual."
        ),
    historico_politico:
      latestHistoricoYear != null
        ? buildFreshnessInfo(
            "historico_politico",
            "Trajetória política",
            data.historicoEmRevisao ? "stale" : "historical",
            data.historicoEmRevisao
              ? `${historicoFreshnessMessage} A trajetória ainda está em revisão factual.`
              : (historicoFreshnessMessage ?? "Trajetória política estruturada."),
            null,
            latestHistoricoYear,
            null,
            "Histórico político"
          )
        : buildFreshnessInfo(
            "historico_politico",
            "Trajetória política",
            "missing",
            "Sem trajetória política estruturada."
          ),
    mudancas_partido:
      latestMudancaYear != null
        ? buildFreshnessInfo(
            "mudancas_partido",
            "Histórico partidário",
            data.timelinePartidariaIncompleta ? "stale" : "historical",
            data.timelinePartidariaIncompleta
              ? `Última mudança de partido registrada em ${latestMudancaYear}. A linha do tempo ainda não chegou à filiação atual publicada.`
              : `Última mudança de partido registrada em ${latestMudancaYear}.`,
            null,
            latestMudancaYear,
            null,
            "Histórico partidário"
          )
        : buildFreshnessInfo(
            "mudancas_partido",
            "Histórico partidário",
            "missing",
            "Sem linha do tempo partidária estruturada."
          ),
    patrimonio:
      latestPatrimonioYear != null
        ? buildFreshnessInfo(
            "patrimonio",
            "Patrimônio",
            "historical",
            `Dado mais recente disponível: eleição de ${latestPatrimonioYear}.`,
            null,
            latestPatrimonioYear,
            null,
            "TSE"
          )
        : buildFreshnessInfo(
            "patrimonio",
            "Patrimônio",
            "missing",
            "Sem patrimônio estruturado."
          ),
    financiamento:
      latestFinanciamentoYear != null
        ? buildFreshnessInfo(
            "financiamento",
            "Financiamento",
            "historical",
            `Dado mais recente disponível: eleição de ${latestFinanciamentoYear}.`,
            null,
            latestFinanciamentoYear,
            null,
            "TSE"
          )
        : buildFreshnessInfo(
            "financiamento",
            "Financiamento",
            "missing",
            "Sem financiamento estruturado."
          ),
    projetos_lei:
      latestProjetoYear != null
        ? buildFreshnessInfo(
            "projetos_lei",
            "Projetos de lei",
            "historical",
            `Projeto mais recente disponível: ${latestProjetoYear}.`,
            null,
            latestProjetoYear,
            null,
            "API legislativa"
          )
        : buildFreshnessInfo(
            "projetos_lei",
            "Projetos de lei",
            "missing",
            "Sem projetos de lei estruturados."
          ),
    votos_candidato:
      latestVoteDate
        ? buildFreshnessInfo(
            "votos_candidato",
            "Votações",
            "historical",
            `Votação mais recente registrada em ${formatDate(latestVoteDate)}.`,
            latestVoteDate.toISOString(),
            latestVoteDate.getFullYear(),
            null,
            "API legislativa"
          )
        : buildFreshnessInfo(
            "votos_candidato",
            "Votações",
            "missing",
            "Sem histórico estruturado de votações."
          ),
    gastos_parlamentares:
      latestGastoYear != null
        ? buildFreshnessInfo(
            "gastos_parlamentares",
            "Gastos parlamentares",
            "historical",
            `Dados disponíveis até ${latestGastoYear}.`,
            null,
            latestGastoYear,
            null,
            "Gastos parlamentares"
          )
        : buildFreshnessInfo(
            "gastos_parlamentares",
            "Gastos parlamentares",
            "missing",
            "Sem gastos parlamentares estruturados."
          ),
  }
}

function warnDevSupabaseFailure(functionName: string, error?: { message?: string } | null) {
  if (!IS_DEV) return
  const message = error?.message ?? "erro desconhecido"
  console.warn(`[api:${functionName}] Supabase indisponível — resposta vazia (sem dados sintéticos): ${message}`)
}

async function getCandidatosResourceUncached(
  cargo?: string,
  estado?: string
): Promise<DataResource<Candidato[]>> {
  if (USE_MOCK) {
    return degradedResource([], SUPABASE_REQUIRED_MESSAGE)
  }

  const supabase = createServerSupabaseClient()
  const { data, error } = await withSupabaseRetry("getCandidatos", async () => {
    let query = supabase
      .from(CANDIDATO_PUBLIC_RELATION)
      .select(CANDIDATO_COLUMNS)
      .neq("status", "removido")

    if (cargo) {
      query = query.eq("cargo_disputado", cargo)
    }

    if (estado) {
      query = query.ilike("estado", estado)
    }

    return query.order("nome_urna")
  })

  if (error || !data) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getCandidatos", error)
    } else {
      console.error("getCandidatos failed:", error?.message)
    }
    return degradedResource(
      [],
      "Não foi possível carregar a lista de candidatos nesta tentativa."
    )
  }
  // Sanitizacao publica de partido_sigla/partido_atual centralizada aqui
  // (substitui as 4 fronteiras do Bloco 1: CandidatoFichaView, embed/page.tsx,
  // uf/[uf]/page.tsx, preview/candidato/[slug]/page.tsx). Ver
  // src/lib/public-candidate-sanitize.ts.
  return liveResource(sanitizePublicPartyFieldsList(data as Candidato[]))
}

const getCachedCandidatosResource = unstable_cache(
  async (cargo?: string, estado?: string) => getCandidatosResourceUncached(cargo, estado),
  // Bumped 2026-04-26: payload publico agora carrega partido_sigla/partido_atual
  // ja sanitizados (incerto -> null, aliases canonicalizados via formatPartyPublicLabel).
  // Suffix bumpado para "central-party-sanitize" para invalidar cache antigo do Bloco 1.
  // Bumped 2026-05-15: swap da coorte presidencial remove tarcisio/eduardo-leite
  // da superficie publica e adiciona augusto-cury/cabo-daciolo/edmilson-costa.
  // Bumped 2026-05-22: publicacao da lista editorial de pre-candidatos dos lotes 1 e 2.
  ["public-candidatos-resource", "central-party-sanitize", "presidential-cohort-20260515", "public-profile-density-20260517", "pre-candidates-lote12-20260522", "photos-names-20260610", "andre-portugues-lote8-20260630"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidatos"],
  }
)

export async function getCandidatosResource(
  cargo?: string,
  estado?: string
): Promise<DataResource<Candidato[]>> {
  return getCachedCandidatosResource(cargo, estado)
}

/**
 * Lista enxuta para navegação prev/next entre fichas do mesmo cargo. A ficha só
 * lê `slug` e `nome_urna` para montar os links anterior/próximo, então projetar
 * apenas essas duas colunas (em vez das 25 de CANDIDATO_COLUMNS via
 * getCandidatosResource) corta tempo de serialize e o tamanho do payload em
 * cache na rota mais quente do site.
 */
export interface CandidatoNavItem {
  slug: string
  nome_urna: string
}

async function getCandidatoNavResourceUncached(
  cargo?: string
): Promise<DataResource<CandidatoNavItem[]>> {
  if (USE_MOCK) {
    return degradedResource([], SUPABASE_REQUIRED_MESSAGE)
  }

  const supabase = createServerSupabaseClient()
  const { data, error } = await withSupabaseRetry("getCandidatoNav", async () => {
    let query = supabase
      .from(CANDIDATO_PUBLIC_RELATION)
      .select("slug, nome_urna")
      .neq("status", "removido")

    if (cargo) {
      query = query.eq("cargo_disputado", cargo)
    }

    return query.order("nome_urna")
  })

  if (error || !data) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getCandidatoNav", error)
    } else {
      console.error("getCandidatoNav failed:", error?.message)
    }
    return degradedResource(
      [],
      "Não foi possível carregar a navegação entre candidatos nesta tentativa."
    )
  }

  return liveResource(data as CandidatoNavItem[])
}

const getCachedCandidatoNavResource = unstable_cache(
  async (cargo?: string) => getCandidatoNavResourceUncached(cargo),
  ["public-candidato-nav-resource", "slug-nome-urna-20260603"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidatos"],
  }
)

export async function getCandidatoNavResource(
  cargo?: string
): Promise<DataResource<CandidatoNavItem[]>> {
  return getCachedCandidatoNavResource(cargo)
}

const VOTACAO_SEARCH_PAGE_SIZE = 1000

function normalizeVotacaoSearchRow(raw: unknown): VotacaoSearchRow {
  const r = raw as { candidato_id: string; votacao: unknown }
  let votacao: { tema: string | null; titulo: string | null } | null = null
  if (Array.isArray(r.votacao)) {
    const v = r.votacao[0] as { tema?: string | null; titulo?: string | null } | undefined
    if (v && typeof v === "object") {
      votacao = { tema: v.tema ?? null, titulo: v.titulo ?? null }
    }
  } else if (r.votacao && typeof r.votacao === "object") {
    const v = r.votacao as { tema?: string | null; titulo?: string | null }
    votacao = { tema: v.tema ?? null, titulo: v.titulo ?? null }
  }
  return { candidato_id: r.candidato_id, votacao }
}

async function fetchAllVotacaoSearchRows(
  supabase: ReturnType<typeof createServerSupabaseClient>
): Promise<{ rows: VotacaoSearchRow[]; error: { message: string } | null }> {
  const rows: VotacaoSearchRow[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await withSupabaseRetry(
      `votos_candidato-global-search-${offset}`,
      async () =>
        supabase
          .from("votos_candidato")
          .select("candidato_id, votacao:votacoes_chave(tema, titulo)")
          .range(offset, offset + VOTACAO_SEARCH_PAGE_SIZE - 1)
    )
    if (error) {
      return { rows, error: { message: error.message ?? "unknown error" } }
    }
    const batch = (data ?? []).map(normalizeVotacaoSearchRow)
    rows.push(...batch)
    if (batch.length < VOTACAO_SEARCH_PAGE_SIZE) break
    offset += VOTACAO_SEARCH_PAGE_SIZE
  }
  return { rows, error: null }
}

async function getGlobalSearchIndexResourceUncached(): Promise<
  DataResource<GlobalSearchIndexItem[]>
> {
  if (USE_MOCK) {
    return degradedResource([], SUPABASE_REQUIRED_MESSAGE)
  }

  const candidatosRes = await getCandidatosResource()
  const candidatos = candidatosRes.data

  if (candidatos.length === 0) {
    return {
      data: [],
      sourceStatus: candidatosRes.sourceStatus,
      sourceMessage: candidatosRes.sourceMessage,
    }
  }

  const supabase = createServerSupabaseClient()
  const { rows, error } = await fetchAllVotacaoSearchRows(supabase)

  let tagsById = new Map<string, { temas: string[]; titulos: string[] }>()
  let votosMessage: string | null = null

  if (error) {
    votosMessage =
      "Temas de votação não puderam ser carregados; a busca usa só nome, partido e estado."
    warnDevSupabaseFailure("global-search-votos", error)
    if (!IS_DEV) {
      console.error("global search votos_candidato failed:", error.message)
    }
  } else {
    tagsById = mergeVotacaoTagsByCandidatoId(rows)
  }

  const data = buildGlobalSearchIndexItems(candidatos, tagsById)

  const sourceStatus = mergeSourceStatuses(
    candidatosRes.sourceStatus,
    votosMessage ? "degraded" : "live"
  )
  const sourceMessage = mergeSourceMessages(candidatosRes.sourceMessage, votosMessage)

  return {
    data,
    sourceStatus,
    sourceMessage,
  }
}

const getCachedGlobalSearchIndexResource = unstable_cache(
  async () => getGlobalSearchIndexResourceUncached(),
  // Bumped 2026-04-26 (Bloco 1 review 2026-04-24): force one-time bust of Vercel
  // Data Cache so the new subtitle/searchText (without raw 'incerto') is exercised.
  ["global-search-index", "bloco1-incerto-suppress", "presidential-cohort-20260515", "public-profile-density-20260517", "pre-candidates-lote12-20260522", "photos-names-20260610"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidatos"],
  }
)

export async function getGlobalSearchIndexResource(): Promise<
  DataResource<GlobalSearchIndexItem[]>
> {
  return getCachedGlobalSearchIndexResource()
}

/**
 * Uma linha de `candidatos_publico` por pedido — partilhada entre `generateMetadata` e a ficha
 * (evita dois SELECT completos ao mesmo slug no mesmo request).
 */
const getCandidatoPublicRowForRequest = cache(async function loadCandidatoPublicRowForRequest(
  slug: string,
  cacheMode: "no-store" | undefined = undefined
): Promise<DataResource<Candidato | null>> {
  if (USE_MOCK) {
    return degradedResource(null, SUPABASE_REQUIRED_MESSAGE)
  }

  const supabase = createServerSupabaseClient(cacheMode ? { cacheMode } : undefined)
  const { data, error } = await withSupabaseRetry<Candidato>(
    `getCandidatoPublicRow(${slug})`,
    async () =>
      supabase
        .from(CANDIDATO_PUBLIC_RELATION)
        .select(CANDIDATO_COLUMNS)
        .eq("slug", slug)
        .single()
  )

  if (isSupabaseNoRowError(error)) {
    // Slug inexistente: precisa virar HTTP 404 na rota, nao uma ficha degradada com 200.
    return liveResource(null)
  }

  if (error) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getCandidatoPublicRow", error)
    } else {
      console.error("getCandidatoPublicRow failed:", error.message)
    }
    return degradedResource(
      null,
      "Não foi possível carregar os metadados desta ficha agora."
    )
  }

  return liveResource(data ?? null)
})

async function getCandidatoSlugParamsUncached(): Promise<{ slug: string }[]> {
  if (USE_MOCK) {
    return []
  }

  const supabase = createServerSupabaseClient()
  const { data, error } = await withSupabaseRetry("getCandidatoSlugParams", async () =>
    supabase.from(CANDIDATO_PUBLIC_RELATION).select("slug").neq("status", "removido").order("slug")
  )

  if (error || !data) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getCandidatoSlugParams", error)
    } else {
      console.error("getCandidatoSlugParams failed:", error?.message)
    }
    // NUNCA retornar [] numa FALHA: o unstable_cache guardaria a lista vazia por
    // APP_DATA_REVALIDATE_SECONDS (1h) e o middleware passaria a 404 toda ficha,
    // anulando o proprio fail-open. Lancar impede o cache de uma falha transiente;
    // o /api/candidato-slugs trata o throw como 503 e o middleware entra em
    // fail-open (review 2026-06-09). USE_MOCK acima ja cobre o vazio legitimo.
    throw new Error(
      `getCandidatoSlugParams: leitura de slugs falhou${error?.message ? `: ${error.message}` : ""}`,
    )
  }

  return data.map((row) => ({ slug: String(row.slug) }))
}

const getCachedCandidatoSlugParams = unstable_cache(
  async () => getCandidatoSlugParamsUncached(),
  ["public-candidato-slugs-static", "presidential-cohort-20260515", "public-profile-density-20260517", "pre-candidates-lote12-20260522", "photos-names-20260610"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidatos"],
  }
)

/** Só `slug` — para `generateStaticParams` (evita carregar todas as colunas de todos os candidatos). */
export async function getCandidatoSlugStaticParams(): Promise<{ slug: string }[]> {
  return getCachedCandidatoSlugParams()
}

async function getCandidatoMetadataResourceUncached(
  slug: string
): Promise<DataResource<Candidato | null>> {
  const res = await getCandidatoPublicRowForRequest(slug, "no-store")
  if (!res.data) return res
  // Sanitiza partido_sigla/partido_atual ANTES do payload sair em metadata publica
  // (substitui mapping pontual em src/app/(site)/candidato/[slug]/page.tsx).
  return { ...res, data: sanitizePublicPartyFields(res.data) }
}

const getCachedCandidatoMetadataResource = unstable_cache(
  async (slug: string) =>
    requireLiveResourceForCache(await getCandidatoMetadataResourceUncached(slug)),
  // Bumped 2026-04-26: payload publico agora carrega partido_sigla/partido_atual
  // ja sanitizados via sanitizePublicPartyFields. Suffix invalida cache antigo.
  ["public-candidato-metadata-resource", "central-party-sanitize", "no-cache-degraded-v1", "presidential-cohort-20260515", "public-profile-density-20260517", "editorial-full-closure-20260518", "pre-candidates-lote12-20260522", "photos-names-20260610", "andre-portugues-lote8-20260630"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidato-metadata"],
  }
)

export async function getCandidatoMetadataResource(
  slug: string
): Promise<DataResource<Candidato | null>> {
  try {
    return await getCachedCandidatoMetadataResource(slug)
  } catch {
    return getCandidatoMetadataResourceUncached(slug)
  }
}

async function getCandidatoBySlugFromRelationResource(
  slug: string,
  relation: string,
  useServiceRole = false,
  cacheMode: "no-store" | undefined = undefined
): Promise<DataResource<FichaCandidato | null>> {
  if (USE_MOCK) {
    return degradedResource(null, SUPABASE_REQUIRED_MESSAGE)
  }

  const shouldUseServiceRole = useServiceRole

  const supabase = shouldUseServiceRole
    ? createServiceRoleSupabaseClient({ cacheMode: "no-store" })
    : createServerSupabaseClient(cacheMode ? { cacheMode } : undefined)

  let candidato: Candidato | null

  if (!shouldUseServiceRole && relation === CANDIDATO_PUBLIC_RELATION) {
    const rowRes = await getCandidatoPublicRowForRequest(slug, cacheMode)
    if (rowRes.sourceStatus === "degraded") {
      if (IS_DEV) {
        warnDevSupabaseFailure("getCandidatoBySlug", { message: rowRes.sourceMessage ?? undefined })
      } else {
        console.error("getCandidatoBySlug failed:", rowRes.sourceMessage)
      }
      return degradedResource(
        null,
        rowRes.sourceMessage ?? "Não foi possível carregar esta ficha agora. Tente novamente em instantes."
      )
    }
    candidato = rowRes.data
    if (!candidato) return liveResource(null)
  } else {
    const { data, error: candidatoError } = await withSupabaseRetry<Candidato>(
      `getCandidatoBySlug(${slug})`,
      async () =>
        supabase
          .from(relation)
          .select(CANDIDATO_COLUMNS)
          .eq("slug", slug)
          .single()
    )

    if (isSupabaseNoRowError(candidatoError)) {
      // Slug inexistente: precisa virar HTTP 404 na rota, nao uma ficha degradada com 200.
      return liveResource(null)
    }

    if (candidatoError) {
      if (IS_DEV) {
        warnDevSupabaseFailure("getCandidatoBySlug", candidatoError)
      } else {
        console.error("getCandidatoBySlug failed:", candidatoError.message)
      }
      return degradedResource(
        null,
        "Não foi possível carregar esta ficha agora. Tente novamente em instantes."
      )
    }

    candidato = data ?? null
    if (!candidato) return liveResource(null)
  }

  const id = candidato.id
  const canonical = getCanonicalPerson(slug)
  let personLevelIds = [id]

  if (canonical.slugs.length > 1) {
    const canonicalLookupRelation = shouldUseServiceRole ? "candidatos" : relation
    const { data: relatedCandidates, error: relatedError } = await withSupabaseRetry(
      `getCanonicalCandidates(${slug})`,
      async () =>
        supabase
          .from(canonicalLookupRelation)
          .select("id, slug")
          .in("slug", canonical.slugs)
    )

    if (!relatedError && relatedCandidates) {
      const relatedIds = relatedCandidates
        .map((item) => item.id)
        .filter((value): value is string => Boolean(value))

      if (relatedIds.length > 0) {
        personLevelIds = relatedIds
      }
    }
  }

  const [historico, mudancas, patrimonio, financiamento, votos, processos, pontos, projetos, legislacaoExecutivo, gastos, sancoes, noticias, indicadores] =
    await Promise.all([
      withSupabaseRetry(`historico_politico(${slug})`, async () =>
        supabase.from("historico_politico").select("*").eq("candidato_id", id).order("periodo_inicio", { ascending: false })
      ),
      withSupabaseRetry(`mudancas_partido(${slug})`, async () =>
        supabase
          .from("mudancas_partido")
          .select("*")
          .eq("candidato_id", id)
          .order("data_mudanca", { ascending: false, nullsFirst: false })
          .order("ano", { ascending: false })
      ),
      withSupabaseRetry(`patrimonio(${slug})`, async () =>
        supabase.from("patrimonio").select("*").in("candidato_id", personLevelIds).order("ano_eleicao", { ascending: false })
      ),
      withSupabaseRetry(`financiamento_publico(${slug})`, async () =>
        supabase.from("financiamento_publico").select("*").in("candidato_id", personLevelIds).order("ano_eleicao", { ascending: false })
      ),
      withSupabaseRetry(`votos_candidato(${slug})`, async () =>
        supabase.from("votos_candidato").select("*, votacao:votacoes_chave(*)").eq("candidato_id", id)
      ),
      withSupabaseRetry(`processos(${slug})`, async () =>
        supabase.from("processos").select("*").eq("candidato_id", id)
      ),
      withSupabaseRetry(`pontos_atencao(${slug})`, async () =>
        supabase.from("pontos_atencao").select("*").eq("candidato_id", id).eq("visivel", true)
      ),
      withSupabaseRetry(`projetos_lei(${slug})`, async () =>
        supabase
          .from("projetos_lei")
          .select("*", { count: "exact" })
          .eq("candidato_id", id)
          .order("ano", { ascending: false })
          .order("numero", { ascending: false })
          .limit(25)
      ),
      withSupabaseRetry(`legislacao_mandato_executivo(${slug})`, async () =>
        fetchLegislacaoMandatoExecutivoRowsPaged(supabase, id)
          .then((data) => ({ data, error: null }))
          .catch((error: unknown) => ({
            data: null,
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
          }))
      ),
      withSupabaseRetry(`gastos_parlamentares(${slug})`, async () =>
        supabase.from("gastos_parlamentares").select("*").eq("candidato_id", id).order("ano", { ascending: false })
      ),
      withSupabaseRetry(`sancoes_administrativas(${slug})`, async () =>
        supabase.from("sancoes_administrativas").select("*").eq("candidato_id", id).order("data_inicio", { ascending: false })
      ),
      withSupabaseRetry(`noticias_candidato(${slug})`, async () =>
        supabase.from("noticias_candidato").select("*").eq("candidato_id", id).order("data_publicacao", { ascending: false }).limit(20)
      ),
      candidato.cargo_disputado === "Governador" && candidato.estado
        ? withSupabaseRetry(`indicadores_estaduais(${slug})`, async () =>
            supabase.from("indicadores_estaduais").select("*").ilike("estado", candidato.estado!).order("ano", { ascending: false })
          )
        : Promise.resolve({ data: [] as IndicadorEstadual[] }),
    ])

  const relatedErrors = [
    historico.error,
    mudancas.error,
    patrimonio.error,
    financiamento.error,
    votos.error,
    processos.error,
    pontos.error,
    projetos.error,
    legislacaoExecutivo.error,
    gastos.error,
    sancoes.error,
    noticias.error,
    "error" in indicadores ? indicadores.error : null,
  ].filter(Boolean)

  const historicoConfiavel = normalizeHistoricoPoliticoForDisplay(historico.data ?? [])
  const patrimonioConfiavel = normalizePatrimonioForDisplay(patrimonio.data ?? [])
  const financiamentoConfiavel = normalizeFinanciamentoForDisplay(financiamento.data ?? [])
  const mudancasRaw = normalizePartyTimelineForDisplay(mudancas.data ?? []).sort(
    (a, b) => rankMudancaPartido(b) - rankMudancaPartido(a)
  )
  const timelinePartidariaIncompleta = hasIncompletePartyTimeline(
    mudancasRaw,
    candidato.partido_sigla,
    candidato.partido_atual
  )

  const pontosPublicos = shouldUseServiceRole
    ? (pontos.data ?? [])
    : (pontos.data ?? []).filter((p) => isPublicAttentionPoint(p))

  // 2026-05-01: payload publico de LME passa por dedup pos-mapper para manter
  // o cached payload abaixo de 2 MB do Vercel Data Cache. A politica
  // (dedup de metadata.coverage_id duplicado, remocao de campos DB-only nao
  // renderizados, cap em ementa e ordenacao deterministica por data_norma desc
  // -> ano desc -> tipo_norma -> numero) vive em
  // src/lib/legislacao-mandato-executivo-cache.ts.
  const legislacaoExecutivoOrdenado: LegislacaoMandatoExecutivo[] =
    applyLegislacaoMandatoExecutivoCachePolicy(
      (legislacaoExecutivo.data ?? []).map(toPublicLegislacaoMandatoExecutivoRow)
    )

  // Sanitizacao publica de partido_sigla/partido_atual no ponto onde o payload
  // da ficha e construido. Substitui o mapping pontual `fichaForPublicDisplay` que
  // ate o Bloco 1 vivia em src/app/(site)/candidato/[slug]/CandidatoFichaView.tsx.
  // hasIncompletePartyTimeline (linha acima) ja foi calculado com a versao crua.
  const ficha: FichaCandidato = {
    ...sanitizePublicPartyFields(candidato),
    historico: historicoConfiavel,
    mudancas_partido: mudancasRaw,
    patrimonio: patrimonioConfiavel,
    financiamento: shouldUseServiceRole
      ? financiamentoConfiavel
      : sanitizeFinanciamentoForPublic(financiamentoConfiavel),
    votos: sortVotosForPublicDisplay(votos.data ?? []),
    processos: processos.data ?? [],
    pontos_atencao: pontosPublicos,
    projetos_lei: projetos.data ?? [],
    projetos_lei_total: projetos.count ?? (projetos.data ?? []).length,
    projetos_lei_truncados: (projetos.count ?? 0) > (projetos.data ?? []).length,
    legislacao_mandato_executivo: legislacaoExecutivoOrdenado,
    gastos_parlamentares: gastos.data ?? [],
    sancoes_administrativas: sancoes.data ?? [],
    noticias: noticias.data ?? [],
    indicadores_estaduais: indicadores.data ?? [],
    total_processos: (processos.data ?? []).length,
    processos_criminais: (processos.data ?? []).filter((p) => p.tipo === "criminal").length,
    total_mudancas_partido: countPartySwitches(mudancasRaw),
    total_pontos_atencao: pontosPublicos.length,
    pontos_criticos: pontosPublicos.filter((p) => isNegativeHighestSeverityAttentionPoint(p)).length,
    total_sancoes: (sancoes.data ?? []).length,
    historico_descartado: 0,
    historico_em_revisao: false,
    timeline_partidaria_incompleta: timelinePartidariaIncompleta,
    section_freshness: buildSectionFreshness(candidato, {
      historico: historicoConfiavel,
      mudancas: mudancasRaw,
      patrimonio: patrimonioConfiavel,
      financiamento: financiamentoConfiavel,
      votos: votos.data ?? [],
      projetos: projetos.data ?? [],
      gastos: gastos.data ?? [],
      historicoEmRevisao: false,
      timelinePartidariaIncompleta: timelinePartidariaIncompleta,
    }),
  }

  const integrityMessages: string[] = []
  if (timelinePartidariaIncompleta) {
    integrityMessages.push(
      "O histórico partidário desta ficha ainda não incorpora a filiação atual publicada."
    )
  }

  if (relatedErrors.length > 0 || integrityMessages.length > 0) {
    return degradedResource(
      ficha,
      [
        relatedErrors.length > 0
          ? "Nem todas as fontes desta ficha responderam. Algumas seções podem estar incompletas."
          : null,
        ...integrityMessages,
      ]
        .filter(Boolean)
        .join(" ")
    )
  }

  return liveResource(ficha)
}

const PUBLIC_PROFILE_DENSITY_BYPASS_SLUGS = new Set([
  "augusto-cury",
  "cabo-daciolo",
  "edmilson-costa",
  "marcelo-brigadeiro",
  "natasha-slhessarenko",
  "renan-santos",
  "tadeu-de-souza",
])

export async function getCandidatoBySlugResource(
  slug: string
): Promise<DataResource<FichaCandidato | null>> {
  if (PUBLIC_PROFILE_DENSITY_BYPASS_SLUGS.has(slug)) {
    noStore()
    return getCandidatoBySlugResourceUncached(slug)
  }

  const cacheBypass = process.env.PF_RELEASE_VERIFY_CACHE_BYPASS?.trim()
  /** Em produção na Vercel, ler `headers()` em toda ficha torna a rota dinâmica; o bypass fica desligado salvo opt-in explícito. */
  const allowCacheBypass =
    Boolean(cacheBypass) &&
    (process.env.PF_ALLOW_RELEASE_VERIFY_CACHE_BYPASS_IN_PRODUCTION === "1" ||
      process.env.VERCEL_ENV !== "production")
  if (allowCacheBypass) {
    try {
      const h = await headers()
      const bypassHeader = h.get("x-pf-release-verify-cache-bypass")
      if (bypassHeader === cacheBypass) {
        noStore()
        return getCandidatoBySlugResourceUncached(slug)
      }
    } catch {
      // Fora de request Next (ou contexto estatico): segue o caminho em cache.
    }
  }
  try {
    return await getCachedCandidatoBySlugResource(slug)
  } catch {
    return getCandidatoBySlugResourceUncached(slug)
  }
}

export async function getCandidatoBySlugPreviewResource(
  slug: string
): Promise<DataResource<FichaCandidato | null>> {
  return getCandidatoBySlugFromRelationResource(slug, "candidatos", true)
}

export interface ProjetosLeiPage {
  rows: ProjetoLei[]
  total: number
  offset: number
  limit: number
}

/** Inventário legislativo paginado para a aba carregada sob demanda. */
export async function getProjetosLeiBySlugResource(
  slug: string,
  offset: number,
  limit: number
): Promise<DataResource<ProjetosLeiPage | null>> {
  if (USE_MOCK) return degradedResource(null, SUPABASE_REQUIRED_MESSAGE)

  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
  const candidate = await getCandidatoPublicRowForRequest(slug, "no-store")
  if (candidate.sourceStatus === "degraded") {
    return degradedResource(null, candidate.sourceMessage)
  }
  if (!candidate.data) return liveResource(null)

  const supabase = createServerSupabaseClient({ cacheMode: "no-store" })
  const { data, error, count } = await withSupabaseRetry(`projetos_lei_page(${slug})`, async () =>
    supabase
      .from("projetos_lei")
      .select("*", { count: "exact" })
      .eq("candidato_id", candidate.data!.id)
      .order("ano", { ascending: false })
      .order("numero", { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1)
  )

  if (error) {
    return degradedResource(null, "Não foi possível carregar o inventário legislativo completo.")
  }
  return liveResource({
    rows: data ?? [],
    total: count ?? (data ?? []).length,
    offset: safeOffset,
    limit: safeLimit,
  })
}

async function getCandidatoBySlugResourceUncached(
  slug: string
): Promise<DataResource<FichaCandidato | null>> {
  return getCandidatoBySlugFromRelationResource(slug, CANDIDATO_PUBLIC_RELATION, false, "no-store")
}

const getCachedCandidatoBySlugResource = unstable_cache(
  async (slug: string) =>
    requireLiveResourceForCache(await getCandidatoBySlugResourceUncached(slug)),
  // Bumped 2026-05-01: payload publico de legislacao_mandato_executivo passou a
  // dropar campos internos (candidato_id/historico_politico_id/created_at/
  // identificador_fonte/fonte_primaria_titulo/fonte_tramitacao_url) e a podar
  // metadata para apenas coverage_id, mantendo o cached payload abaixo de 2 MB
  // do Vercel Data Cache (Build warning 25202862956 em /candidato/[slug] e
  // /embed/[slug] com slugs de inventario completo). Suffix invalida cache antigo
  // com o payload pre-trim.
  ["public-candidato-ficha-resource", "central-party-sanitize", "no-cache-degraded-v1", "legislacao-paged-v4", "lme-trim-2mb-20260501", "pl-lazy-preview-20260711", "presidential-cohort-20260515", "editorial-full-closure-20260518", "pre-candidates-lote12-20260522", "photos-names-20260610", "raw-empty-core-lote2-20260630", "raw-empty-core-lote3-20260630", "raw-empty-core-lote4-20260630", "raw-empty-core-news-lote5-20260630", "raw-empty-core-lote6-20260630", "raw-empty-core-lote7-20260630", "raw-empty-core-lote8-20260630", "raw-empty-core-lote9-20260630", "raw-empty-core-lote10-20260630", "raw-empty-core-lote11-20260630", "pe-state-html-gaps-20260708", "rr-state-completion-20260710-v2"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidato-ficha"],
  }
)

export interface CandidatoResumo {
  candidato: Candidato
  patrimonio: number | null
  processos: number
  pontos_atencao: number
}

async function getCandidatosComResumoResourceUncached(
  cargo?: string,
  estado?: string
): Promise<DataResource<CandidatoResumo[]>> {
  const candidatosResource = await getCandidatosResource(cargo, estado)
  const candidatos = candidatosResource.data

  if (candidatosResource.sourceStatus !== "live") {
    return {
      ...candidatosResource,
      data: candidatos.map((c) => ({
        candidato: c,
        patrimonio: null,
        processos: 0,
        pontos_atencao: 0,
      })),
    }
  }

  if (candidatos.length === 0) {
    return liveResource([])
  }

  const supabase = createServerSupabaseClient()
  const { data: compareRows, error: compareError } = await withSupabaseRetry(
    "v_comparador(resumo)",
    async () => {
      let query = supabase
        .from("v_comparador")
        .select("id, cargo_disputado, estado, total_processos, patrimonio_declarado, pontos_atencao")

      if (cargo) {
        query = query.eq("cargo_disputado", cargo)
      }

      if (estado) {
        query = query.ilike("estado", estado)
      }

      return query
    }
  )

  const compareMap = new Map<
    string,
    { patrimonio: number | null; processos: number; pontosAtencao: number }
  >()
  for (const row of compareRows ?? []) {
    compareMap.set(row.id, {
      patrimonio: row.patrimonio_declarado ?? null,
      processos: row.total_processos ?? 0,
      pontosAtencao: Array.isArray(row.pontos_atencao) ? row.pontos_atencao.length : 0,
    })
  }

  const data = candidatos.map((c) => ({
    candidato: c,
    patrimonio: compareMap.get(c.id)?.patrimonio ?? null,
    processos: compareMap.get(c.id)?.processos ?? 0,
    pontos_atencao: compareMap.get(c.id)?.pontosAtencao ?? 0,
  }))

  if (compareError) {
    return degradedResource(
      data,
      "Nem todos os resumos puderam ser enriquecidos. Alguns totais podem estar zerados temporariamente."
    )
  }

  return liveResource(data)
}

const getCachedCandidatosComResumoResource = unstable_cache(
  async (cargo?: string, estado?: string) =>
    getCandidatosComResumoResourceUncached(cargo, estado),
  // Bumped 2026-04-26: dados de candidato vem ja sanitizados via getCandidatosResource;
  // o suffix forca bust de cache antigo do Bloco 1.
  ["public-candidatos-resumo-resource", "central-party-sanitize", "presidential-cohort-20260515", "public-profile-density-20260517", "pre-candidates-lote12-20260522", "photos-names-20260610", "andre-portugues-lote8-20260630"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidatos-resumo"],
  }
)

export async function getCandidatosComResumoResource(
  cargo?: string,
  estado?: string
): Promise<DataResource<CandidatoResumo[]>> {
  return getCachedCandidatosComResumoResource(cargo, estado)
}

async function getCandidatosComparaveisResourceUncached(
  cargo?: string,
  estado?: string
): Promise<DataResource<CandidatoComparavel[]>> {
  const cargoFilter = cargo ?? "Presidente"
  if (USE_MOCK) {
    return degradedResource([], SUPABASE_REQUIRED_MESSAGE)
  }

  const supabase = createServerSupabaseClient()
  const { data, error: compareError } = await withSupabaseRetry(
    `v_comparador(${cargoFilter}${estado ? `:${estado}` : ""})`,
    async () => {
      let query = supabase
        .from("v_comparador")
        .select("*")
        .eq("cargo_disputado", cargoFilter)

      if (estado) {
        query = query.ilike("estado", estado)
      }

      return query.order("nome_urna")
    }
  )
  if (compareError) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getCandidatosComparaveis", compareError)
    } else {
      console.error("getCandidatosComparaveis failed:", compareError.message)
    }
    return degradedResource(
      [],
      "Não foi possível montar a comparação nesta tentativa."
    )
  }

  const baseRows = data ?? []
  const comparadorIds = baseRows.map((r) => r.id).filter((id): id is string => Boolean(id))

  const switchCountById = new Map<string, number>()
  const gastoTotalsById = new Map<string, number>()
  const votosCountById = new Map<string, number>()
  if (comparadorIds.length > 0) {
    // As três agregações (mudanças de partido, gastos, votos) dependem só de
    // comparadorIds e não umas das outras, então rodam num único Promise.all em
    // vez de duas stages sequenciais. Corta um round-trip serial no cold render.
    const [mudRows, gastoMap, votoMap] = await Promise.all([
      fetchMudancasPartidoRowsPaged(supabase, comparadorIds),
      fetchGastoTotalsByCandidatoIds(supabase, comparadorIds),
      fetchVotosCountsByCandidatoIds(supabase, comparadorIds),
    ])

    const byCandidato = new Map<string, MudancaPartido[]>()
    for (const row of mudRows) {
      const cid = row.candidato_id as string
      const list = byCandidato.get(cid) ?? []
      list.push(row as MudancaPartido)
      byCandidato.set(cid, list)
    }
    for (const [cid, list] of byCandidato) {
      switchCountById.set(cid, countPartySwitches(list))
    }
    for (const cid of comparadorIds) {
      if (!switchCountById.has(cid)) switchCountById.set(cid, 0)
    }

    gastoMap.forEach((v, k) => gastoTotalsById.set(k, v))
    votoMap.forEach((v, k) => votosCountById.set(k, v))
  }

  const normalizedRows = baseRows.map((row) => {
    const pontos = Array.isArray(row.pontos_atencao) ? row.pontos_atencao : []
    const { alertasGraves } = classifyAttentionPoints(pontos)

    const normalized = {
      ...row,
      alertas_graves: alertasGraves.length,
      mudancas_partido: switchCountById.has(row.id)
        ? (switchCountById.get(row.id) ?? 0)
        : row.mudancas_partido,
      total_gasto_parlamentar: gastoTotalsById.has(row.id)
        ? (gastoTotalsById.get(row.id) ?? null)
        : null,
      total_votos_mapeados: votosCountById.get(row.id) ?? 0,
    }
    // pontos_atencao só serve para derivar alertas_graves no servidor; o
    // ComparadorPanel nunca lê o array no cliente. Remove do payload público
    // (e do cache de comparáveis) em vez de serializar sem uso.
    delete (normalized as { pontos_atencao?: unknown }).pontos_atencao
    return normalized
  })

  // Sanitiza partido_sigla/partido_atual antes do payload publico sair
  // (substitui mapping pontual em ComparadorPanel/RankingTable defensivos).
  return liveResource(sanitizePublicPartyFieldsList(normalizedRows as CandidatoComparavel[]))
}

const getCachedCandidatosComparaveisResource = unstable_cache(
  async (cargo?: string, estado?: string) =>
    getCandidatosComparaveisResourceUncached(cargo, estado),
  // Bumped 2026-04-26: payload publico carrega partido sanitizado.
  // Bumped 2026-06-03: pontos_atencao removido do payload de comparaveis (so
  // alimentava alertas_graves no servidor, nunca lido no cliente).
  ["public-candidatos-comparaveis-resource", "central-party-sanitize", "presidential-cohort-20260515", "public-profile-density-20260517", "comparaveis-strip-pontos-20260603", "photos-names-20260610"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-candidatos-comparaveis"],
  }
)

export async function getCandidatosComparaveisResource(
  cargo?: string,
  estado?: string
): Promise<DataResource<CandidatoComparavel[]>> {
  return getCachedCandidatosComparaveisResource(cargo, estado)
}

function toRankingCandidateSummary(candidate: Pick<Candidato, 'id' | 'nome_urna' | 'slug' | 'partido_sigla' | 'cargo_disputado' | 'estado' | 'foto_url'>): RankingCandidateSummary {
  return {
    id: candidate.id,
    nome_urna: candidate.nome_urna,
    slug: candidate.slug,
    partido_sigla: candidate.partido_sigla,
    cargo_disputado: candidate.cargo_disputado,
    estado: candidate.estado,
    foto_url: candidate.foto_url,
  }
}

function toRankingFieldCandidate(candidate: CandidatoComparavel): RankingFieldCandidate {
  return {
    id: candidate.id,
    nome_urna: candidate.nome_urna,
    slug: candidate.slug,
    partido_sigla: candidate.partido_sigla,
    cargo_disputado: candidate.cargo_disputado,
    estado: candidate.estado,
    foto_url: candidate.foto_url,
    mudancas_partido: candidate.mudancas_partido,
    patrimonio_declarado: candidate.patrimonio_declarado,
  }
}

async function getFieldRankingEntriesResource(
  definition: RankingDefinition,
  cargo: string,
  estado?: string
): Promise<DataResource<RankingEntry[]>> {
  if (!definition.sourceField) {
    return liveResource([])
  }

  const comparaveisResource = await getCandidatosComparaveisResource(cargo, estado)
  // Default desc sort: OG images and index cards read entries[0] as leader
  const entries = sortRankingEntries(
    buildFieldRankingEntries({
      candidatos: comparaveisResource.data.map(toRankingFieldCandidate),
      sourceField: definition.sourceField,
    })
  )

  return {
    ...comparaveisResource,
    data: entries,
  }
}

async function getAggregateRankingEntriesResource(
  definition: RankingDefinition,
  cargo: string,
  estado?: string
): Promise<DataResource<RankingEntry[]>> {
  const candidatosResource = await getCandidatosResource(cargo, estado)
  const candidatos = candidatosResource.data.map((candidate) =>
    toRankingCandidateSummary(candidate)
  )
  // Default desc sort: OG images and index cards read entries[0] as leader
  const buildEntries = (rows: Array<{ candidato_id: string; metricValue: number | null }>) =>
    sortRankingEntries(buildAggregateRankingEntries({ candidatos, rows }))

  if (candidatosResource.sourceStatus !== "live") {
    return {
      ...candidatosResource,
      data: buildEntries([]),
    }
  }

  if (candidatos.length === 0) {
    return liveResource([])
  }

  const supabase = createServerSupabaseClient()
  const candidateIds = candidatos.map((candidato) => candidato.id)

  switch (definition.tableName) {
    case "gastos_parlamentares": {
      let totalsMap: Map<string, number>
      try {
        totalsMap = await fetchGastoTotalsByCandidatoIds(supabase, candidateIds)
      } catch (fetchError) {
        const err =
          fetchError instanceof Error ? fetchError : new Error(String(fetchError))
        if (IS_DEV) {
          warnDevSupabaseFailure("getRankingData", err)
        } else {
          console.error("getRankingData gastos aggregate failed:", err.message)
        }
        return degradedResource(
          buildEntries([]),
          "Não foi possível calcular esta métrica nesta tentativa."
        )
      }

      const rows = candidatos.map((candidato) => ({
        candidato_id: candidato.id,
        metricValue: totalsMap.has(candidato.id) ? (totalsMap.get(candidato.id) ?? null) : null,
      }))

      return liveResource(buildEntries(rows))
    }

    default:
      return liveResource(buildEntries([]))
  }
}

async function getRankingDataResourceUncached(
  slug: string,
  cargo?: string,
  estado?: string
): Promise<DataResource<RankingDataset>> {
  const definition = getRankingDefinitionBySlug(slug)
  if (!definition) {
    throw new Error(`Unknown ranking slug: ${slug}`)
  }

  const normalized = normalizeRankingFilters({ cargo, uf: estado })
  const estadoFilter = definition.supportsUf ? normalized.estado : undefined

  const entriesResource =
    definition.queryType === "comparador-field"
      ? await getFieldRankingEntriesResource(definition, normalized.cargo, estadoFilter)
      : await getAggregateRankingEntriesResource(definition, normalized.cargo, estadoFilter)

  return {
    ...entriesResource,
    data: {
      definition,
      cargo: normalized.cargo,
      estado: estadoFilter,
      entries: entriesResource.data,
    },
  }
}

const getCachedRankingDataResource = unstable_cache(
  async (slug: string, cargo: string, estado: string) =>
    getRankingDataResourceUncached(slug, cargo || undefined, estado || undefined),
  // Bumped 2026-05-21: copy pública de rankings virou "listas temáticas";
  // invalida definition.title/contextExplanation serializados no Data Cache.
  ["ranking-data-resource-public-copy-20260521"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["ranking-data"],
  }
)

export async function getRankingDataResource(
  slug: string,
  cargo?: string,
  estado?: string
): Promise<DataResource<RankingDataset>> {
  return getCachedRankingDataResource(slug, cargo ?? "", estado ?? "")
}

async function getQuizAlignmentDatasetResourceUncached(
  cargo = "Presidente",
  estado?: string
): Promise<DataResource<QuizAlignmentDataset>> {
  const estadoNorm = estado?.trim() || undefined

  if (USE_MOCK) {
    return degradedResource(
      {
        candidatos: [],
        votacoes_mapeadas: [],
        votacao_titulo_to_id: {},
        votacao_fonte_por_titulo: {},
      },
      SUPABASE_REQUIRED_MESSAGE
    )
  }

  const candidatosRes = await getCandidatosResourceUncached(cargo, estadoNorm)
  const candidatos = candidatosRes.data

  if (candidatos.length === 0) {
    return {
      data: {
        candidatos: [],
        votacoes_mapeadas: [],
        votacao_titulo_to_id: {},
        votacao_fonte_por_titulo: {},
      },
      sourceStatus: candidatosRes.sourceStatus,
      sourceMessage: candidatosRes.sourceMessage,
    }
  }

  const titulos = collectQuizVotacaoTitulos(QUIZ_PERGUNTAS)
  const supabase = createServerSupabaseClient()

  const { data: rowsVotacoes, error: errVotacoes } = await withSupabaseRetry(
    "quiz-votacoes-chave",
    async () =>
      supabase.from("votacoes_chave").select("id,titulo,casa,proposicao_id").in("titulo", titulos)
  )

  if (errVotacoes || !rowsVotacoes) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getQuizAlignmentDatasetResource", errVotacoes)
    } else {
      console.error("quiz votacoes_chave failed:", errVotacoes?.message)
    }
    const fallbackCandidatos: QuizCandidatoData[] = candidatos.map((c) => ({
      id: c.id,
      slug: c.slug,
      nome_urna: c.nome_urna,
      partido_sigla: c.partido_sigla,
      foto_url: c.foto_url,
      cargo_disputado: c.cargo_disputado,
      estado: c.estado ?? null,
      votos: {},
    }))
    return degradedResource(
      {
        candidatos: fallbackCandidatos,
        votacoes_mapeadas: [],
        votacao_titulo_to_id: {},
        votacao_fonte_por_titulo: {},
      },
      mergeSourceMessages(
        candidatosRes.sourceMessage,
        "Mapeamento de votações do quiz indisponível; comparação usa apenas espectro partidário."
      )
    )
  }

  const tituloToId: Record<string, string> = {}
  const votacaoFontePorTitulo: Record<string, string | null> = {}
  for (const row of rowsVotacoes) {
    tituloToId[row.titulo] = row.id
    votacaoFontePorTitulo[row.titulo] = buildVotacaoPublicUrl(
      row.casa as string | null,
      row.proposicao_id as string | null
    )
  }
  const votacaoIds = [...new Set(Object.values(tituloToId))]
  const candidatoIds = candidatos.map((c) => c.id)

  let votosRows: {
    candidato_id: string
    votacao_id: string
    voto: string
    contradicao: boolean | null
    contradicao_descricao: string | null
  }[] = []
  let votosFailed = false
  if (votacaoIds.length > 0 && candidatoIds.length > 0) {
    const { data, error: errVotos } = await withSupabaseRetry("quiz-votos-candidato", async () =>
      supabase
        .from("votos_candidato")
        .select("candidato_id,votacao_id,voto,contradicao,contradicao_descricao")
        .in("candidato_id", candidatoIds)
        .in("votacao_id", votacaoIds)
    )
    if (errVotos) {
      votosFailed = true
      if (IS_DEV) {
        warnDevSupabaseFailure("getQuizAlignmentDatasetResource-votos", errVotos)
      } else {
        console.error("quiz votos_candidato failed:", errVotos.message)
      }
    } else {
      votosRows = data ?? []
    }
  }

  const votosPorCandidato = new Map<string, QuizCandidatoData["votos"]>()
  const contradicoesPorCandidato = new Map<string, QuizContradicaoVoto[]>()
  for (const c of candidatos) {
    votosPorCandidato.set(c.id, {})
    contradicoesPorCandidato.set(c.id, [])
  }
  for (const row of votosRows) {
    const n = normalizeVotoFromApi(row.voto)
    if (!n) continue
    const bag = votosPorCandidato.get(row.candidato_id)
    if (bag) {
      bag[row.votacao_id] = n
    }
    if (
      row.contradicao &&
      row.contradicao_descricao?.trim() &&
      votacaoIds.includes(row.votacao_id)
    ) {
      let titulo = ""
      for (const [t, vid] of Object.entries(tituloToId)) {
        if (vid === row.votacao_id) {
          titulo = t
          break
        }
      }
      if (!titulo) continue
      contradicoesPorCandidato.get(row.candidato_id)?.push({
        votacao_titulo: titulo,
        descricao: row.contradicao_descricao.trim(),
      })
    }
  }

  const plPorCandidato = new Map<string, Record<string, number>>()
  const plUrlPorCandidato = new Map<string, Record<string, string>>()
  const mudancasPorCandidato = new Map<string, number>()
  const posPorCandidato = new Map<string, QuizPosicaoDeclarada[]>()
  const financiamentoPorCandidato = new Map<string, string | null>()
  const financiamentoPerfilPorCandidato = new Map<string, QuizFinanciamentoDoacaoPerfil>()
  for (const c of candidatos) {
    plPorCandidato.set(c.id, {})
    plUrlPorCandidato.set(c.id, {})
    mudancasPorCandidato.set(c.id, 0)
    posPorCandidato.set(c.id, [])
    financiamentoPorCandidato.set(c.id, null)
  }

  if (candidatoIds.length > 0) {
    const { data: plData } = await withSupabaseRetry("quiz-projetos-lei", async () =>
      supabase
        .from("projetos_lei")
        .select("candidato_id,tema,url_inteiro_teor")
        .in("candidato_id", candidatoIds)
        .not("tema", "is", null)
    )
    for (const row of plData ?? []) {
      const tema = typeof row.tema === "string" ? row.tema.trim() : ""
      if (!tema) continue
      const bag = plPorCandidato.get(row.candidato_id) ?? {}
      bag[tema] = (bag[tema] ?? 0) + 1
      plPorCandidato.set(row.candidato_id, bag)
      const urlRaw = typeof row.url_inteiro_teor === "string" ? row.url_inteiro_teor.trim() : ""
      if (urlRaw) {
        const urlBag = plUrlPorCandidato.get(row.candidato_id as string) ?? {}
        if (!urlBag[tema]) {
          urlBag[tema] = urlRaw
          plUrlPorCandidato.set(row.candidato_id as string, urlBag)
        }
      }
    }

    const { data: mudData } = await withSupabaseRetry("quiz-mudancas-partido", async () =>
      supabase
        .from("mudancas_partido")
        .select("candidato_id,id,ano,partido_anterior,partido_novo,data_mudanca,contexto")
        .in("candidato_id", candidatoIds)
    )
    const mudancasRowsByCandidato = new Map<string, MudancaPartido[]>()
    for (const c of candidatos) {
      mudancasRowsByCandidato.set(c.id, [])
    }
    for (const row of mudData ?? []) {
      const id = row.candidato_id as string
      const list = mudancasRowsByCandidato.get(id) ?? []
      list.push(row as MudancaPartido)
      mudancasRowsByCandidato.set(id, list)
    }
    for (const c of candidatos) {
      mudancasPorCandidato.set(
        c.id,
        countPartySwitches(mudancasRowsByCandidato.get(c.id) ?? [])
      )
    }

    const { data: posData, error: posErr } = await withSupabaseRetry("quiz-posicoes-declaradas", async () =>
      supabase
        .from("posicoes_declaradas")
        .select("candidato_id,tema,posicao,descricao,fonte,url_fonte")
        .in("candidato_id", candidatoIds)
        .eq("verificado", true)
    )
    if (!posErr && posData) {
      for (const row of posData) {
        const po = row.posicao as string
        if (po !== "a_favor" && po !== "contra" && po !== "ambiguo") continue
        posPorCandidato.get(row.candidato_id as string)?.push({
          tema: row.tema as string,
          posicao: po as QuizPosicaoDeclarada["posicao"],
          descricao: row.descricao as string | null,
          fonte: row.fonte as string | null,
          url_fonte: row.url_fonte as string | null,
        })
      }
    } else if (posErr && IS_DEV) {
      console.warn("quiz posicoes_declaradas:", posErr.message)
    }

    const { data: finRows, error: finErr } = await withSupabaseRetry("quiz-financiamento", async () =>
      supabase
        .from("financiamento_publico")
        .select("candidato_id,ano_eleicao,total_arrecadado,maiores_doadores")
        .in("candidato_id", candidatoIds)
    )
    if (!finErr && finRows?.length) {
      const latestByCandidato = new Map<
        string,
        { ano: number; total: number | null; maiores: unknown }
      >()
      for (const row of finRows) {
        const cid = row.candidato_id as string
        const ano = Number(row.ano_eleicao)
        if (!Number.isFinite(ano)) continue
        const prev = latestByCandidato.get(cid)
        if (!prev || ano > prev.ano) {
          latestByCandidato.set(cid, {
            ano,
            total: row.total_arrecadado != null ? Number(row.total_arrecadado) : null,
            maiores: sanitizeMaioresDoadoresForPublic(row.maiores_doadores),
          })
        }
      }
      for (const [cid, pack] of latestByCandidato) {
        const ctx = buildFinanciamentoContexto(pack.ano, pack.total, pack.maiores)
        financiamentoPorCandidato.set(cid, ctx)
        const perfil = buildFinanciamentoDoacaoPerfil(pack.maiores, pack.total)
        if (perfil) financiamentoPerfilPorCandidato.set(cid, perfil)
      }
    } else if (finErr && IS_DEV) {
      console.warn("quiz financiamento:", finErr.message)
    }
  }

  const out: QuizCandidatoData[] = candidatos.map((c) => {
    const pls = plPorCandidato.get(c.id) ?? {}
    const plUrls = plUrlPorCandidato.get(c.id) ?? {}
    const pos = posPorCandidato.get(c.id) ?? []
    const ctr = contradicoesPorCandidato.get(c.id) ?? []
    const finCtx = financiamentoPorCandidato.get(c.id) ?? null
    const finPerfil = financiamentoPerfilPorCandidato.get(c.id)
    return {
      id: c.id,
      slug: c.slug,
      nome_urna: c.nome_urna,
      partido_sigla: c.partido_sigla,
      foto_url: c.foto_url,
      cargo_disputado: c.cargo_disputado,
      estado: c.estado ?? null,
      votos: votosPorCandidato.get(c.id) ?? {},
      pls_por_tema: Object.keys(pls).length > 0 ? pls : undefined,
      pl_url_exemplo_por_tema: Object.keys(plUrls).length > 0 ? plUrls : undefined,
      posicoes_declaradas: pos.length > 0 ? pos : undefined,
      contradicoes_voto: ctr.length > 0 ? ctr : undefined,
      mudancas_partido_count: mudancasPorCandidato.get(c.id) ?? 0,
      ...(finCtx ? { financiamento_contexto: finCtx } : {}),
      ...(finPerfil ? { financiamento_doacao_perfil: finPerfil } : {}),
    }
  })

  const dataset: QuizAlignmentDataset = {
    candidatos: out,
    votacoes_mapeadas: votacaoIds,
    votacao_titulo_to_id: tituloToId,
    votacao_fonte_por_titulo: votacaoFontePorTitulo,
  }

  const sourceStatus = mergeSourceStatuses(
    candidatosRes.sourceStatus,
    votosFailed ? "degraded" : "live"
  )
  const sourceMessage = mergeSourceMessages(
    candidatosRes.sourceMessage,
    votosFailed ? "Votos do Congresso para o quiz não responderam; comparação usa mais o espectro partidário." : null
  )

  return {
    data: dataset,
    sourceStatus,
    sourceMessage,
  }
}

const getCachedQuizAlignmentDatasetResource = unstable_cache(
  async (cargo: string, estado: string) =>
    getQuizAlignmentDatasetResourceUncached(cargo, estado || undefined),
  ["quiz-alignment-dataset-resource", "fase2"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["quiz-dataset"],
  }
)

export async function getQuizAlignmentDatasetResource(
  cargo = "Presidente",
  estado?: string
): Promise<DataResource<QuizAlignmentDataset>> {
  return getCachedQuizAlignmentDatasetResource(cargo, estado ?? "")
}

const INDICADORES_ESTADO_COLUMNS =
  "id, estado, ano, fonte, indicador, valor, valor_texto" as const
const INDICADORES_RANKING_COLUMNS = "id, estado, ano, indicador, valor, fonte" as const

function mapIndicadorEstadualRow(row: {
  id: string
  estado: string
  ano: number
  fonte: string
  indicador: string
  valor: number | null
  valor_texto: string | null
}): IndicadorEstadual {
  return {
    ...row,
    unidade: null,
    metadata: null,
  }
}

async function getIndicadoresEstadoResourceUncached(
  uf: string
): Promise<DataResource<IndicadorEstadual[]>> {
  if (USE_MOCK) {
    return degradedResource([], SUPABASE_REQUIRED_MESSAGE)
  }
  const supabase = createServerSupabaseClient()
  const { data, error } = await withSupabaseRetry(
    `indicadores_estaduais(${uf})`,
    async () =>
      supabase
        .from("indicadores_estaduais")
        .select(INDICADORES_ESTADO_COLUMNS)
        .ilike("estado", uf)
        .order("ano", { ascending: false })
  )

  if (error || !data) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getIndicadoresEstadoResource", error)
      return degradedResource(
        [],
        "Indicadores estaduais indisponíveis. Seção do território pode ficar vazia."
      )
    }
    console.error("getIndicadoresEstadoResource failed:", error?.message)
    return degradedResource(
      [],
      "Não foi possível carregar indicadores estaduais nesta tentativa."
    )
  }

  return liveResource(data.map(mapIndicadorEstadualRow))
}

const getCachedIndicadoresEstadoResource = unstable_cache(
  async (uf: string) => getIndicadoresEstadoResourceUncached(uf),
  ["public-indicadores-estado-resource"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-indicadores-estado"],
  }
)

export async function getIndicadoresEstadoResource(
  uf: string
): Promise<DataResource<IndicadorEstadual[]>> {
  return getCachedIndicadoresEstadoResource(uf)
}

async function getIndicadoresAllEstadosResourceUncached(): Promise<
  DataResource<IndicadorEstadualRanking[]>
> {
  if (USE_MOCK) {
    return degradedResource([], SUPABASE_REQUIRED_MESSAGE)
  }
  const supabase = createServerSupabaseClient()
  const { data, error } = await withSupabaseRetry("indicadores_estaduais_all", async () =>
    supabase
      .from("indicadores_estaduais")
      .select(INDICADORES_RANKING_COLUMNS)
      .order("ano", { ascending: false })
  )

  if (error || !data) {
    if (IS_DEV) {
      warnDevSupabaseFailure("getIndicadoresAllEstadosResource", error)
      return degradedResource(
        [],
        "Ranking nacional de indicadores indisponível nesta tentativa."
      )
    }
    console.error("getIndicadoresAllEstadosResource failed:", error?.message)
    return degradedResource(
      [],
      "Não foi possível carregar indicadores para ranking nesta tentativa."
    )
  }

  return liveResource(
    data.map((row): IndicadorEstadualRanking => ({
      id: row.id,
      estado: row.estado,
      ano: row.ano,
      indicador: row.indicador,
      valor: row.valor ?? null,
      fonte: row.fonte ?? null,
    }))
  )
}

const getCachedIndicadoresAllEstadosResource = unstable_cache(
  async () => getIndicadoresAllEstadosResourceUncached(),
  ["public-indicadores-all-estados-resource"],
  {
    revalidate: APP_DATA_REVALIDATE_SECONDS,
    tags: ["public-indicadores-all"],
  }
)

export async function getIndicadoresAllEstadosResource(): Promise<
  DataResource<IndicadorEstadualRanking[]>
> {
  return getCachedIndicadoresAllEstadosResource()
}

export { getEstadoNome, getEstadoUFs } from "@/lib/br-uf"

const api = {
  mergeSourceStatuses,
  mergeSourceMessages,
  getCandidatosResource,
  getGlobalSearchIndexResource,
  getCandidatoSlugStaticParams,
  getCandidatoMetadataResource,
  getCandidatoBySlugResource,
  getCandidatoBySlugPreviewResource,
  getCandidatosComResumoResource,
  getCandidatosComparaveisResource,
  getRankingDataResource,
  getQuizAlignmentDatasetResource,
  getIndicadoresEstadoResource,
  getIndicadoresAllEstadosResource,
}

export default api
