/**
 * Client-safe normalizacao de sigla/nome de partido (espelha `normalizePartyValue`
 * em `scripts/lib/party-canonical.ts` sem depender de Node/scripts).
 */
export function normalizePartySigla(value: string | null | undefined): string {
  if (!value || !value.trim()) return ""
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase()
}

interface CanonicalPartyDefinition {
  sigla: string
  aliases: string[]
}

interface HistoricalPartyGroupDefinition {
  group: string
  labels: string[]
}

interface HistoricalPartyDisplayDefinition {
  historicalLabel: string
  modernLabel: string
  switchYear: number
}

const CANONICAL_PARTIES: CanonicalPartyDefinition[] = [
  { sigla: "PDS", aliases: ["Partido Democrático Social", "Partido Democratico Social"] },
  { sigla: "PT", aliases: ["Partido dos Trabalhadores"] },
  { sigla: "PTB", aliases: ["Partido Trabalhista Brasileiro"] },
  {
    sigla: "SEMPARTIDO",
    aliases: [
      "Sem partido",
      "Sem Partido",
      "Independente",
      "Sem filiacao partidaria",
      "Sem filiação partidária",
    ],
  },
  { sigla: "PL", aliases: ["Partido Liberal"] },
  { sigla: "PPR", aliases: ["Partido Progressista Reformador"] },
  { sigla: "PPB", aliases: ["Partido Progressista Brasileiro"] },
  { sigla: "PR", aliases: ["Partido da República", "Partido da Republica"] },
  { sigla: "REPUBLICANOS", aliases: ["Republicanos"] },
  { sigla: "PRB", aliases: ["Partido Republicano Brasileiro"] },
  { sigla: "NOVO", aliases: ["Partido Novo", "Novo"] },
  { sigla: "UNIAO", aliases: ["União Brasil", "Uniao Brasil", "UNIÃO"] },
  { sigla: "PSD", aliases: ["Partido Social Democrático", "Partido Social Democratico"] },
  { sigla: "PMN", aliases: ["Mobilização Nacional", "Mobilizacao Nacional"] },
  {
    sigla: "PAN",
    aliases: ["Partido dos Aposentados da Nação", "Partido dos Aposentados da Nacao"],
  },
  { sigla: "PROS", aliases: ["Partido Republicano da Ordem Social"] },
  { sigla: "PSL", aliases: ["Partido Social Liberal"] },
  { sigla: "DEM", aliases: ["Democratas"] },
  { sigla: "PFL", aliases: ["Partido da Frente Liberal"] },
  {
    sigla: "PSDB",
    aliases: ["Partido da Social Democracia Brasileira", "Partido Social Democrata Brasileiro"],
  },
  { sigla: "PSB", aliases: ["Partido Socialista Brasileiro"] },
  { sigla: "PSOL", aliases: ["Partido Socialismo e Liberdade"] },
  { sigla: "DC", aliases: ["Democracia Cristã", "Democracia Crista"] },
  { sigla: "MISSAO", aliases: ["Partido Missão", "Partido Missao", "Missão", "Missao"] },
  {
    sigla: "PDT",
    aliases: ["Partido Democrático Trabalhista", "Partido Democratico Trabalhista"],
  },
  { sigla: "PSC", aliases: ["Partido Social Cristão", "Partido Social Cristao"] },
  {
    sigla: "PHS",
    aliases: ["Partido Humanista da Solidariedade", "Partido Humanista da Solidaridade"],
  },
  {
    sigla: "DIVERSOS",
    aliases: ["Diversos", "diversos"],
  },
  {
    sigla: "PSTU",
    aliases: ["Partido Socialista dos Trabalhadores Unificado"],
  },
  { sigla: "PCO", aliases: ["Partido da Causa Operária", "Partido da Causa Operaria"] },
  { sigla: "UP", aliases: ["Unidade Popular"] },
  {
    sigla: "PMDB",
    aliases: ["Partido do Movimento Democrático Brasileiro", "Partido do Movimento Democratico Brasileiro"],
  },
  { sigla: "MDB", aliases: ["Movimento Democrático Brasileiro", "Movimento Democratico Brasileiro"] },
  { sigla: "PP", aliases: ["Progressistas", "Partido Progressista"] },
  { sigla: "PCdoB", aliases: ["Partido Comunista do Brasil", "PCDOB"] },
  { sigla: "PTN", aliases: ["Partido Trabalhista Nacional"] },
  { sigla: "PODE", aliases: ["Podemos", "PODEMOS"] },
  { sigla: "PPS", aliases: ["Partido Popular Socialista"] },
  { sigla: "CIDADANIA", aliases: ["Cidadania"] },
  { sigla: "PV", aliases: ["Partido Verde"] },
  {
    sigla: "REDE",
    aliases: ["Rede Sustentabilidade"],
  },
  {
    sigla: "PT DO B",
    aliases: ["Partido Trabalhista do Brasil", "PTDOB", "PTdoB"],
  },
  { sigla: "AVANTE", aliases: ["Avante"] },
  { sigla: "D35", aliases: ["Democrata", "Democrata 35", "DEMOCRATA", "O Democrata"] },
  { sigla: "AGIR", aliases: ["Agir", "Agir 36", "AGIR 36"] },
  { sigla: "PRP", aliases: ["Partido Republicano Progressista"] },
  { sigla: "PRD", aliases: ["Partido Renovação Democrática", "Partido Renovacao Democratica"] },
  { sigla: "PRTB", aliases: ["Partido Renovador Trabalhista Brasileiro"] },
  { sigla: "Solidariedade", aliases: ["Solidariedade", "SD", "SOLIDARIEDADE"] },
  { sigla: "PTC", aliases: ["Partido Trabalhista Cristão", "Partido Trabalhista Cristao"] },
  { sigla: "PMB", aliases: ["Partido da Mulher Brasileira"] },
]

const CANONICAL_PARTY_BY_TOKEN = new Map<string, string>()

for (const party of CANONICAL_PARTIES) {
  CANONICAL_PARTY_BY_TOKEN.set(normalizePartySigla(party.sigla), party.sigla)
  for (const alias of party.aliases) {
    CANONICAL_PARTY_BY_TOKEN.set(normalizePartySigla(alias), party.sigla)
  }
}

const HISTORICAL_PARTY_GROUPS: HistoricalPartyGroupDefinition[] = [
  { group: "MDB", labels: ["MDB", "PMDB"] },
  { group: "CIDADANIA", labels: ["CIDADANIA", "PPS", "Partido Popular Socialista"] },
  { group: "REPUBLICANOS", labels: ["REPUBLICANOS", "PRB", "Partido Republicano Brasileiro"] },
  { group: "DEM", labels: ["DEM", "DEMOCRATAS", "PFL", "Partido da Frente Liberal"] },
  { group: "PODE", labels: ["PODE", "PODEMOS", "PTN", "Partido Trabalhista Nacional"] },
  { group: "PP", labels: ["PP", "PPB", "PPR", "Progressistas"] },
  { group: "PL", labels: ["PL", "PR", "Partido Liberal", "Partido da Republica"] },
  { group: "AVANTE", labels: ["AVANTE", "PT DO B", "PTDOB", "Partido Trabalhista do Brasil"] },
]

const HISTORICAL_PARTY_GROUP_BY_TOKEN = new Map<string, string>()

for (const group of HISTORICAL_PARTY_GROUPS) {
  for (const label of group.labels) {
    HISTORICAL_PARTY_GROUP_BY_TOKEN.set(normalizePartySigla(label), group.group)
  }
}

const PARTY_DISPLAY_BY_TOKEN: Record<string, string> = {
  PCDOB: "PCdoB",
  SD: "Solidariedade",
  SOLIDARIEDADE: "Solidariedade",
  SEMPARTIDO: "Sem partido",
}

const HISTORICAL_PARTY_DISPLAY: Record<string, HistoricalPartyDisplayDefinition> = {
  MDB: { historicalLabel: "PMDB", modernLabel: "MDB", switchYear: 2018 },
  CIDADANIA: { historicalLabel: "PPS", modernLabel: "CIDADANIA", switchYear: 2019 },
  REPUBLICANOS: { historicalLabel: "PRB", modernLabel: "REPUBLICANOS", switchYear: 2019 },
  DEM: { historicalLabel: "PFL", modernLabel: "DEM", switchYear: 2007 },
  PODE: { historicalLabel: "PTN", modernLabel: "PODE", switchYear: 2017 },
  AVANTE: { historicalLabel: "PT DO B", modernLabel: "AVANTE", switchYear: 2017 },
  PL: { historicalLabel: "PR", modernLabel: "PL", switchYear: 2019 },
}

export function resolveCanonicalPartySigla(value: string | null | undefined): string | null {
  const token = normalizePartySigla(value)
  if (!token) return null
  return CANONICAL_PARTY_BY_TOKEN.get(token) ?? null
}

export function partiesEquivalent(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const leftCanonical = resolveCanonicalPartySigla(left)
  const rightCanonical = resolveCanonicalPartySigla(right)
  return !!leftCanonical && !!rightCanonical && leftCanonical === rightCanonical
}

function resolveHistoricalPartyGroup(
  value: string | null | undefined
): string | null {
  const canonical = resolveCanonicalPartySigla(value)
  const token = normalizePartySigla(canonical ?? value)
  if (!token) return null
  return HISTORICAL_PARTY_GROUP_BY_TOKEN.get(token) ?? token
}

export function partiesHistoricallyEquivalent(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const leftGroup = resolveHistoricalPartyGroup(left)
  const rightGroup = resolveHistoricalPartyGroup(right)
  return !!leftGroup && !!rightGroup && leftGroup === rightGroup
}

function getHistoricalDisplayLabel(
  value: string | null | undefined,
  year: number | null | undefined,
): string | null {
  if (year == null) return null

  const group = resolveHistoricalPartyGroup(value)
  if (!group) return null

  const rule = HISTORICAL_PARTY_DISPLAY[group]
  if (!rule) return null

  return year < rule.switchYear ? rule.historicalLabel : rule.modernLabel
}

export function formatPartyDisplayLabel(
  value: string | null | undefined,
  options?: { year?: number | null } | null,
): string {
  if (!value || !value.trim()) return ""

  const historical = getHistoricalDisplayLabel(value, options?.year)
  if (historical) {
    const historicalToken = normalizePartySigla(historical)
    return PARTY_DISPLAY_BY_TOKEN[historicalToken] ?? historical
  }

  const canonical = resolveCanonicalPartySigla(value)
  if (canonical) {
    const token = normalizePartySigla(canonical)
    return PARTY_DISPLAY_BY_TOKEN[token] ?? canonical
  }
  return PARTY_DISPLAY_BY_TOKEN[normalizePartySigla(value)] ?? value.trim()
}

const UNCERTAIN_PARTY_TOKENS: ReadonlySet<string> = new Set(["INCERTO", "SEMPARTIDO"])

export function isUncertainParty(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return true
  return UNCERTAIN_PARTY_TOKENS.has(normalizePartySigla(value))
}

export function formatPartyPublicLabel(
  value: string | null | undefined,
  options?: { year?: number | null } | null,
): string {
  if (isUncertainParty(value)) return ""
  return formatPartyDisplayLabel(value, options)
}
