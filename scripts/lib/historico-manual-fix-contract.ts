import type { HistoricoFix } from "../apply-current-factual-fixes"
import { canonicalCargo } from "../../src/lib/cargo-utils"
import { inferHistoricoTipoEventoFromRow } from "./historico-tipo-evento"

/**
 * Contrato factual linha-a-linha para `historicoFix` manual em
 * `scripts/apply-current-factual-fixes.ts`.
 *
 * Este módulo é fonte única dos contratos tier-1 e pós-tier-1. Tanto
 * `tests/historico-manual-fix-contract.test.ts` (guard executável) quanto
 * `scripts/audit-historico-manual-universe.ts` (auditoria de cobertura)
 * importam daqui para garantir que cobertura e enforcement usam o mesmo
 * predicado row-level (`matchesExpectedRow`).
 *
 * Histórico documental em `curadoria interna` (Fluxo 2; log 2026-04-14,
 * 2026-04-17, 2026-04-21 e reauditoria Fase B 2026-04-22).
 */

export type Tier1Expected = {
  cargo_canonico: string
  tipo_evento: "mandato" | "candidatura"
  periodo_inicio: number
  /** null indica "em vigor" (periodo_fim=null). */
  periodo_fim: number | null
}

export type Tier1NegatedCandidatura = {
  cargo_canonico: string
  periodo_inicio: number
  /** Tolerância para apontar a mesma linha com cargo variante (ex.: "Presidente" vs "Presidente da República"). */
  alsoMatchesCargos?: string[]
  reason: string
  /** Fontes/âncoras primárias que justificam a negação. */
  sources: string[]
}

export type BiografiaForbiddenPhrase = {
  /** Regex aplicado case-insensitive à biografia em `candidateUpdate`. */
  pattern: RegExp
  reason: string
}

export type Tier1Contract = {
  slug: string
  expected: Tier1Expected[]
  negatedCandidaturas: Tier1NegatedCandidatura[]
  biografiaForbidden?: BiografiaForbiddenPhrase[]
}

export type PostTier1SensitiveExpected = Tier1Expected & {
  whySensitive: string
  sourceAnchors: string[]
}

export type PostTier1SensitiveContract = {
  slug: string
  expectedCandidaturas: PostTier1SensitiveExpected[]
}

export type RemovedTokenHistorico = {
  slug: string
  cargo: string
  periodo_inicio: number
}

const CANDIDATURA_MARKERS = ["candidatura", "pleito", "não eleito", "nao eleito"]

export const SENSITIVE_MAJORITARIAN_CANDIDATURA_CARGOS = new Set([
  "Presidente",
  "Vice-Presidente",
  "Governador",
  "Vice-Governador",
  "Prefeito",
  "Vice-Prefeito",
  "Senador",
  "1o Suplente Senador",
  "2o Suplente Senador",
])

export const TIER_1_TRAJETORIA_CONTRACT: Tier1Contract[] = [
  {
    slug: "lula",
    expected: [
      { cargo_canonico: "Presidente", tipo_evento: "mandato", periodo_inicio: 2003, periodo_fim: 2006 },
      { cargo_canonico: "Presidente", tipo_evento: "mandato", periodo_inicio: 2007, periodo_fim: 2010 },
      { cargo_canonico: "Presidente", tipo_evento: "mandato", periodo_inicio: 2023, periodo_fim: null },
    ],
    negatedCandidaturas: [
      {
        cargo_canonico: "Presidente",
        periodo_inicio: 2018,
        alsoMatchesCargos: ["Presidente", "Presidente da República"],
        reason:
          "Lula teve registro de candidatura indeferido pelo TSE em 2018 (Lei da Ficha Limpa); foi substituído por Fernando Haddad antes da votação. Não concorreu como candidato válido — representar como 'Candidatura — Não Eleito' é factualmente incorreto.",
        sources: [
          "TSE DivulgaCandContas 2018 (situação de registro: INDEFERIDO)",
          "STF/TSE — Lei da Ficha Limpa (LC 135/2010)",
          "Presidência da República (gov.br) — biografia oficial de Lula",
        ],
      },
      {
        cargo_canonico: "Presidente",
        periodo_inicio: 2022,
        alsoMatchesCargos: ["Presidente", "Presidente da República"],
        reason:
          "Lula foi eleito Presidente da República em 2022, com posse em 01/01/2023. Representar o pleito de 2022 como 'Candidatura — Não Eleito' contradiz o mandato eleito 2023–atual (duplicação semântica conflitante).",
        sources: [
          "TSE DivulgaCandContas 2022 (situação de resultado: ELEITO)",
          "Planalto/Presidência da República — posse 01/01/2023",
        ],
      },
    ],
  },
  {
    slug: "haddad-gov-sp",
    expected: [
      { cargo_canonico: "Ministro da Fazenda", tipo_evento: "mandato", periodo_inicio: 2023, periodo_fim: null },
      { cargo_canonico: "Ministro da Educação", tipo_evento: "mandato", periodo_inicio: 2005, periodo_fim: 2012 },
      { cargo_canonico: "Prefeito", tipo_evento: "mandato", periodo_inicio: 2013, periodo_fim: 2016 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2018, periodo_fim: 2018 },
    ],
    negatedCandidaturas: [
      {
        cargo_canonico: "Presidente",
        periodo_inicio: 2022,
        alsoMatchesCargos: ["Presidente", "Presidente da República"],
        reason:
          "Haddad disputou o governo de São Paulo em 2022 (indo ao 2º turno contra Tarcísio de Freitas), não a Presidência. A row TSE correta 'Governador 2022 NÃO ELEITO' já existe no DB via ingest; a linha manual 'Presidente 2022' era factualmente falsa.",
        sources: [
          "TSE DivulgaCandContas 2022 (pleito de Governador SP pelo PT; 2º turno)",
          "imprensa federal / apuração oficial TSE 2022 — candidatura presidencial do PT em 2022 foi de Luiz Inácio Lula da Silva",
        ],
      },
    ],
    biografiaForbidden: [
      {
        pattern: /candidato\s+[^\.]{0,80}Presid[eê]ncia[^\.]{0,80}\b2018\s+e\s+2022\b/i,
        reason:
          "Biografia afirmando 'candidato à Presidência em 2018 e 2022' é factualmente falsa para Haddad — em 2022 o pleito foi ao Governo de SP. Se a biografia precisa mencionar 2022, tem que deixar claro que foi candidatura a Governador.",
      },
    ],
  },
  {
    slug: "ciro-gomes",
    expected: [
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2018, periodo_fim: 2018 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2022, periodo_fim: 2022 },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "hertz-dias",
    expected: [
      { cargo_canonico: "Vice-Presidente", tipo_evento: "candidatura", periodo_inicio: 2018, periodo_fim: 2018 },
      { cargo_canonico: "Prefeito", tipo_evento: "candidatura", periodo_inicio: 2020, periodo_fim: 2020 },
      { cargo_canonico: "Governador", tipo_evento: "candidatura", periodo_inicio: 2022, periodo_fim: 2022 },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "rui-costa-pimenta",
    expected: [
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2002, periodo_fim: 2002 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2010, periodo_fim: 2010 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2014, periodo_fim: 2014 },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "samara-martins",
    expected: [
      { cargo_canonico: "Vice-Presidente", tipo_evento: "candidatura", periodo_inicio: 2022, periodo_fim: 2022 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2026, periodo_fim: 2026 },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "ciro-gomes-gov-ce",
    expected: [
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 1998, periodo_fim: 1998 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2002, periodo_fim: 2002 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2018, periodo_fim: 2018 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2022, periodo_fim: 2022 },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "geraldo-alckmin",
    expected: [
      { cargo_canonico: "Vereador", tipo_evento: "mandato", periodo_inicio: 1972, periodo_fim: 1976 },
      { cargo_canonico: "Prefeito", tipo_evento: "mandato", periodo_inicio: 1976, periodo_fim: 1982 },
      { cargo_canonico: "Deputado Estadual", tipo_evento: "mandato", periodo_inicio: 1983, periodo_fim: 1987 },
      { cargo_canonico: "Governador", tipo_evento: "mandato", periodo_inicio: 2001, periodo_fim: 2018 },
      { cargo_canonico: "Presidente", tipo_evento: "candidatura", periodo_inicio: 2018, periodo_fim: 2018 },
      { cargo_canonico: "Vice-Presidente", tipo_evento: "mandato", periodo_inicio: 2023, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "flavio-bolsonaro",
    expected: [
      { cargo_canonico: "Deputado Estadual", tipo_evento: "mandato", periodo_inicio: 2003, periodo_fim: 2006 },
      { cargo_canonico: "Deputado Estadual", tipo_evento: "mandato", periodo_inicio: 2016, periodo_fim: 2019 },
      { cargo_canonico: "Senador", tipo_evento: "mandato", periodo_inicio: 2019, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "tarcisio-gov-sp",
    expected: [
      {
        cargo_canonico: "Diretor-Geral do DNIT",
        tipo_evento: "mandato",
        periodo_inicio: 2014,
        periodo_fim: 2015,
      },
      {
        cargo_canonico: "Ministro da Infraestrutura",
        tipo_evento: "mandato",
        periodo_inicio: 2019,
        periodo_fim: 2022,
      },
      {
        cargo_canonico: "Governador",
        tipo_evento: "mandato",
        periodo_inicio: 2023,
        periodo_fim: null,
      },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "ronaldo-caiado",
    expected: [
      { cargo_canonico: "Deputado Federal", tipo_evento: "mandato", periodo_inicio: 1991, periodo_fim: 1998 },
      { cargo_canonico: "Senador", tipo_evento: "mandato", periodo_inicio: 2015, periodo_fim: 2019 },
      { cargo_canonico: "Governador", tipo_evento: "mandato", periodo_inicio: 2026, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "ratinho-junior",
    expected: [
      { cargo_canonico: "Deputado Estadual", tipo_evento: "mandato", periodo_inicio: 2003, periodo_fim: 2003 },
      { cargo_canonico: "Deputado Estadual", tipo_evento: "mandato", periodo_inicio: 2004, periodo_fim: 2007 },
      { cargo_canonico: "Deputado Federal", tipo_evento: "mandato", periodo_inicio: 2011, periodo_fim: 2014 },
      { cargo_canonico: "Secretário", tipo_evento: "mandato", periodo_inicio: 2013, periodo_fim: 2014 },
      { cargo_canonico: "Governador", tipo_evento: "mandato", periodo_inicio: 2019, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "aldo-rebelo",
    expected: [
      { cargo_canonico: "Deputado Federal", tipo_evento: "mandato", periodo_inicio: 1991, periodo_fim: 1994 },
      { cargo_canonico: "Presidente da Câmara dos Deputados", tipo_evento: "mandato", periodo_inicio: 2005, periodo_fim: 2007 },
      { cargo_canonico: "Ministro da Ciência e Tecnologia", tipo_evento: "mandato", periodo_inicio: 2004, periodo_fim: 2005 },
      { cargo_canonico: "Ministro do Esporte", tipo_evento: "mandato", periodo_inicio: 2011, periodo_fim: 2014 },
      { cargo_canonico: "Ministro da Defesa", tipo_evento: "mandato", periodo_inicio: 2015, periodo_fim: 2016 },
      { cargo_canonico: "Senador", tipo_evento: "candidatura", periodo_inicio: 2022, periodo_fim: 2022 },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "sergio-moro-gov-pr",
    expected: [
      { cargo_canonico: "Senador", tipo_evento: "mandato", periodo_inicio: 2026, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "jorginho-mello",
    expected: [
      { cargo_canonico: "Senador", tipo_evento: "mandato", periodo_inicio: 2019, periodo_fim: 2022 },
      { cargo_canonico: "Governador", tipo_evento: "mandato", periodo_inicio: 2023, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "nikolas-ferreira",
    expected: [],
    negatedCandidaturas: [],
  },
  {
    slug: "eduardo-paes",
    expected: [
      { cargo_canonico: "Prefeito", tipo_evento: "mandato", periodo_inicio: 2021, periodo_fim: null },
      { cargo_canonico: "Prefeito", tipo_evento: "mandato", periodo_inicio: 2009, periodo_fim: 2016 },
      { cargo_canonico: "Ministro do Turismo", tipo_evento: "mandato", periodo_inicio: 2007, periodo_fim: 2008 },
      { cargo_canonico: "Deputado Federal", tipo_evento: "mandato", periodo_inicio: 1999, periodo_fim: 2007 },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "jeronimo",
    expected: [
      { cargo_canonico: "Secretário", tipo_evento: "mandato", periodo_inicio: 2015, periodo_fim: 2018 },
      { cargo_canonico: "Secretário", tipo_evento: "mandato", periodo_inicio: 2019, periodo_fim: 2022 },
      { cargo_canonico: "Governador", tipo_evento: "mandato", periodo_inicio: 2023, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
  {
    slug: "ricardo-nunes",
    expected: [
      { cargo_canonico: "Vereador", tipo_evento: "mandato", periodo_inicio: 2013, periodo_fim: 2020 },
      { cargo_canonico: "Vice-Prefeito", tipo_evento: "mandato", periodo_inicio: 2021, periodo_fim: 2021 },
      { cargo_canonico: "Prefeito", tipo_evento: "mandato", periodo_inicio: 2021, periodo_fim: null },
    ],
    negatedCandidaturas: [],
  },
]

export const POST_TIER1_MAJORITARIAN_CANDIDATURA_CONTRACT: PostTier1SensitiveContract[] = [
  {
    slug: "anderson-ferreira",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2022,
        periodo_fim: 2022,
        whySensitive:
          "Candidatura manual majoritária estadual fora do tier-1; uma row coerente em aparência passa pelos gates estruturais, mas ainda precisa de prova explícita linha a linha.",
        sourceAnchors: ["TSE (consulta_cand 2022)", "imprensa"],
      },
    ],
  },
  {
    slug: "augusto-cury",
    expectedCandidaturas: [
      {
        cargo_canonico: "Presidente",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: 2026,
        whySensitive:
          "Pré-candidatura presidencial manual de 2026; precisa ficar delimitada como pré-candidatura, sem sugerir registro deferido no TSE.",
        sourceAnchors: ["Avante oficial", "Band 2026-05-06"],
      },
    ],
  },
  {
    slug: "cabo-daciolo",
    expectedCandidaturas: [
      {
        cargo_canonico: "Presidente",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: 2026,
        whySensitive:
          "Pré-candidatura presidencial manual de 2026 em partido novo no índice; sem contrato explícito, a row poderia ser lida como candidatura oficial deferida.",
        sourceAnchors: ["Band 2026-04", "Camara dos Deputados"],
      },
    ],
  },
  {
    slug: "clecio-luis",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: 2026,
        whySensitive:
          "Pleito majoritário manual materializado para alinhar timeline partidária; sem contrato explícito, uma row de candidatura pode sobreviver só porque combina com o fluxo estrutural.",
        sourceAnchors: ["G1 AP 2026-01-30", "UNIAO"],
      },
    ],
  },
  {
    slug: "decio-lima",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2018,
        periodo_fim: 2018,
        whySensitive:
          "Candidatura manual a governo estadual, single-year e não eleita; era risco de regressão semântica fora do contrato já fechado.",
        sourceAnchors: ["TSE", "curadoria 19.csv"],
      },
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2022,
        periodo_fim: 2022,
        whySensitive:
          "Mesmo padrão do pleito de 2018: candidatura majoritária manual, plausível estruturalmente, mas sem prova executável antes desta expansão.",
        sourceAnchors: ["TSE", "curadoria 19.csv"],
      },
    ],
  },
  {
    slug: "edegar-pretto",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: 2026,
        whySensitive:
          "Pré-candidatura manual de 2026 com retirada posterior; sem contrato explícito, a row podia parecer coerente e passar como fato estável.",
        sourceAnchors: ["Metropoles", "curadoria 19.csv"],
      },
    ],
  },
  {
    slug: "edmilson-costa",
    expectedCandidaturas: [
      {
        cargo_canonico: "Presidente",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: 2026,
        whySensitive:
          "Pré-candidatura presidencial manual de 2026 lançada por partido; a linha precisa ser executavelmente separada de mandato e de registro eleitoral deferido.",
        sourceAnchors: ["PCB oficial 2026-02", "FAPESP"],
      },
    ],
  },
  {
    slug: "lahesio-bonfim",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2022,
        periodo_fim: 2022,
        whySensitive:
          "Pleito majoritário manual de 2022 fora do tier-1; a ausência de mandato decorrente não basta como prova factual sem contrato.",
        sourceAnchors: ["TSE (pleito 2022)", "PSC"],
      },
      {
        cargo_canonico: "Senador",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: 2026,
        whySensitive:
          "Pré-candidatura manual de 2026 foi reclassificada para Senado após fonte de junho; sem contrato explícito, a row poderia voltar ao enquadramento de governo estadual.",
        sourceAnchors: ["Imirante 2026-06-11", "Senado"],
      },
    ],
  },
  {
    slug: "leandro-grass",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2022,
        periodo_fim: 2022,
        whySensitive:
          "Candidatura manual ao governo do DF; linha semanticamente sensível porque mistura trajetória real com pleito não convertido em mandato.",
        sourceAnchors: ["TSE (pleito 2022)"],
      },
    ],
  },
  {
    slug: "maria-do-carmo",
    expectedCandidaturas: [
      {
        cargo_canonico: "1o Suplente Senador",
        tipo_evento: "candidatura",
        periodo_inicio: 2022,
        periodo_fim: 2022,
        whySensitive:
          "Resultado eleitoral negativo manual em cargo majoritário/suplência sensível; 'não eleito' não pode ficar sustentado apenas por plausibilidade textual.",
        sourceAnchors: ["TSE DivulgaCand", "DS_SIT_TOT_TURNO NÃO ELEITO"],
      },
    ],
  },
  {
    slug: "natasha-slhessarenko",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: 2026,
        whySensitive:
          "Pré-candidatura 2026 lançada manualmente a partir de imprensa/partidos; exige delimitação explícita para não ser lida como mandato ou candidatura deferida.",
        sourceAnchors: ["Imprensa MT", "partidos"],
      },
    ],
  },
  {
    slug: "pedro-cunha-lima",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2022,
        periodo_fim: 2022,
        whySensitive:
          "Pleito ao governo da Paraíba em 2022 inserido manualmente; sem contrato, uma row convincente poderia permanecer sem prova semântica dedicada.",
        sourceAnchors: ["Correio da Paraiba 2026", "TSE"],
      },
    ],
  },
  {
    slug: "roberto-claudio",
    expectedCandidaturas: [
      {
        cargo_canonico: "Governador",
        tipo_evento: "candidatura",
        periodo_inicio: 2026,
        periodo_fim: null,
        whySensitive:
          "Pré-candidatura 2026 mantida como row manual aberta para alinhar partido/pleito; o formato aberto aumenta o risco de ser confundida com mandato sem prova explícita.",
        sourceAnchors: ["12.csv", "pleito", "UNIAO"],
      },
    ],
  },
]

export const REMOVED_TOKEN_HISTORICO_ROWS: RemovedTokenHistorico[] = [
  { slug: "ciro-gomes", cargo: "Deputado Federal", periodo_inicio: 2013 },
  { slug: "ciro-gomes-gov-ce", cargo: "Deputado Federal", periodo_inicio: 2013 },
  { slug: "alvaro-dias-rn", cargo: "Governador", periodo_inicio: 2025 },
  { slug: "alvaro-dias-rn", cargo: "Governador", periodo_inicio: 2026 },
]

export function hasCandidaturaMarker(obs: string | null | undefined): boolean {
  if (!obs) return false
  const lower = obs.toLowerCase()
  return CANDIDATURA_MARKERS.some((m) => lower.includes(m))
}

export function normalizeAuditText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}

export function isElectedMandate(fix: HistoricoFix): boolean {
  return typeof fix.eleito_por === "string" && fix.eleito_por.trim().length > 0
}

export function isManualNaoEleitoCandidatura(fix: HistoricoFix): boolean {
  if (isElectedMandate(fix)) return false
  if (fix.periodo_fim == null) return false
  if (fix.periodo_inicio !== fix.periodo_fim) return false
  return hasCandidaturaMarker(fix.observacoes ?? null)
}

export function isManualSensitiveMajoritarianCandidatura(fix: HistoricoFix): boolean {
  if (isElectedMandate(fix)) return false
  const canon = canonicalCargo(fix.cargo)
  if (!SENSITIVE_MAJORITARIAN_CANDIDATURA_CARGOS.has(canon)) return false
  return (
    inferHistoricoTipoEventoFromRow({
      observacoes: fix.observacoes ?? null,
      periodo_inicio: fix.periodo_inicio,
      periodo_fim: fix.periodo_fim,
    }) === "candidatura"
  )
}

/**
 * Predicado row-level usado por `tests/historico-manual-fix-contract.test.ts`
 * e por `scripts/audit-historico-manual-universe.ts`. Casa a linha manual
 * contra a especificação exata esperada (slug implícito, cargo canônico,
 * janela, tipo de evento).
 */
export function matchesExpectedRow(h: HistoricoFix, exp: Tier1Expected): boolean {
  return (
    canonicalCargo(h.cargo) === exp.cargo_canonico &&
    h.periodo_inicio === exp.periodo_inicio &&
    (h.periodo_fim ?? null) === (exp.periodo_fim ?? null) &&
    (exp.tipo_evento === "mandato" ? isElectedMandate(h) : !isElectedMandate(h))
  )
}
