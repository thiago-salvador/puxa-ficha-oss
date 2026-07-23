export interface CanonicalParty {
  sigla: string
  nome: string
  aliases: string[]
}

const PARTIES: CanonicalParty[] = [
  { sigla: "PDS", nome: "Partido Democrático Social", aliases: ["Partido Democratico Social"] },
  { sigla: "PT", nome: "Partido dos Trabalhadores", aliases: [] },
  {
    sigla: "SEMPARTIDO",
    nome: "Sem partido",
    aliases: [
      "Sem Partido",
      "Independente",
      "Sem filiacao partidaria",
      "Sem filiação partidária",
    ],
  },
  { sigla: "PL", nome: "Partido Liberal", aliases: [] },
  { sigla: "PTB", nome: "Partido Trabalhista Brasileiro", aliases: [] },
  { sigla: "PPR", nome: "Partido Progressista Reformador", aliases: [] },
  { sigla: "PPB", nome: "Partido Progressista Brasileiro", aliases: [] },
  { sigla: "PR", nome: "Partido da República", aliases: ["Partido da Republica"] },
  { sigla: "REPUBLICANOS", nome: "Republicanos", aliases: [] },
  { sigla: "PRB", nome: "Partido Republicano Brasileiro", aliases: [] },
  { sigla: "NOVO", nome: "Partido Novo", aliases: ["Novo"] },
  { sigla: "UNIAO", nome: "União Brasil", aliases: ["Uniao Brasil", "UNIÃO"] },
  { sigla: "PSD", nome: "Partido Social Democrático", aliases: ["Partido Social Democratico"] },
  { sigla: "PMN", nome: "Mobilização Nacional", aliases: ["Mobilizacao Nacional"] },
  {
    sigla: "PAN",
    nome: "Partido dos Aposentados da Nação",
    aliases: ["Partido dos Aposentados da Nacao"],
  },
  {
    sigla: "PROS",
    nome: "Partido Republicano da Ordem Social",
    aliases: [],
  },
  { sigla: "PSL", nome: "Partido Social Liberal", aliases: [] },
  { sigla: "DEM", nome: "Democratas", aliases: [] },
  { sigla: "PFL", nome: "Partido da Frente Liberal", aliases: [] },
  {
    sigla: "PSDB",
    nome: "Partido da Social Democracia Brasileira",
    aliases: ["Partido Social Democrata Brasileiro"],
  },
  { sigla: "PSB", nome: "Partido Socialista Brasileiro", aliases: [] },
  { sigla: "PSOL", nome: "Partido Socialismo e Liberdade", aliases: [] },
  { sigla: "DC", nome: "Democracia Cristã", aliases: ["Democracia Crista"] },
  { sigla: "MISSAO", nome: "Missão", aliases: ["Partido Missao", "Missao", "Partido Missão"] },
  { sigla: "PDT", nome: "Partido Democrático Trabalhista", aliases: ["Partido Democratico Trabalhista"] },
  { sigla: "PSC", nome: "Partido Social Cristão", aliases: ["Partido Social Cristao"] },
  {
    sigla: "PHS",
    nome: "Partido Humanista da Solidariedade",
    aliases: ["Partido Humanista da Solidariedade", "Partido Humanista da Solidaridade"],
  },
  {
    sigla: "DIVERSOS",
    nome: "Agregado editorial — múltiplas legendas em mandato (curadoria)",
    aliases: ["Diversos", "diversos"],
  },
  {
    sigla: "PSTU",
    nome: "Partido Socialista dos Trabalhadores Unificado",
    aliases: [],
  },
  { sigla: "PCO", nome: "Partido da Causa Operária", aliases: ["Partido da Causa Operaria"] },
  { sigla: "UP", nome: "Unidade Popular", aliases: [] },
  {
    sigla: "PMDB",
    nome: "Partido do Movimento Democrático Brasileiro",
    aliases: ["Partido do Movimento Democratico Brasileiro"],
  },
  { sigla: "MDB", nome: "Movimento Democrático Brasileiro", aliases: ["Movimento Democratico Brasileiro"] },
  { sigla: "PP", nome: "Progressistas", aliases: ["Partido Progressista"] },
  { sigla: "PCdoB", nome: "Partido Comunista do Brasil", aliases: ["PCDOB"] },
  {
    sigla: "PTN",
    nome: "Partido Trabalhista Nacional",
    aliases: [],
  },
  { sigla: "PODE", nome: "Podemos", aliases: ["PODEMOS"] },
  { sigla: "PATRIOTA", nome: "Patriota", aliases: [] },
  {
    sigla: "PPS",
    nome: "Partido Popular Socialista",
    aliases: [],
  },
  { sigla: "CIDADANIA", nome: "Cidadania", aliases: [] },
  { sigla: "PV", nome: "Partido Verde", aliases: [] },
  {
    sigla: "REDE",
    nome: "Rede Sustentabilidade",
    aliases: ["Rede Sustentabilidade"],
  },
  {
    sigla: "PT DO B",
    nome: "Partido Trabalhista do Brasil",
    aliases: ["PTDOB", "PTdoB"],
  },
  { sigla: "AVANTE", nome: "Avante", aliases: [] },
  {
    sigla: "D35",
    nome: "Democrata",
    aliases: ["Democrata 35", "DEMOCRATA", "O Democrata"],
  },
  { sigla: "AGIR", nome: "Agir", aliases: ["Agir 36", "AGIR 36"] },
  {
    sigla: "PRP",
    nome: "Partido Republicano Progressista",
    aliases: [],
  },
  {
    sigla: "PRD",
    nome: "Partido Renovação Democrática",
    aliases: ["Partido Renovacao Democratica"],
  },
  { sigla: "PRTB", nome: "Partido Renovador Trabalhista Brasileiro", aliases: [] },
  { sigla: "Solidariedade", nome: "Solidariedade", aliases: ["SD", "SOLIDARIEDADE"] },
  { sigla: "PTC", nome: "Partido Trabalhista Cristão", aliases: ["Partido Trabalhista Cristao"] },
  { sigla: "PMB", nome: "Partido da Mulher Brasileira", aliases: ["Partido da Mulher Brasileira"] },
  // PMN (historico) e MOBILIZA (rebrand 2022) sao a mesma legenda em eras diferentes,
  // tratadas como entradas distintas igual PMDB/MDB e PFL/DEM. NUNCA listar "PMN" nem
  // "Mobilizacao Nacional" como alias aqui: isso sobrescrevia a chave de indice do PMN e
  // colapsava PMN -> MOBILIZA, reescrevendo historico curado (review 2026-06-09).
  { sigla: "MOBILIZA", nome: "Mobiliza", aliases: [] },
  { sigla: "PCB", nome: "Partido Comunista Brasileiro", aliases: [] },
]

const normalizePartyValue = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase()

const PARTY_INDEX = new Map<string, CanonicalParty>()

// Guard de colisao: cada sigla/nome/alias normalizado deve mapear para um unico
// partido canonico. Sem isso, uma entrada posterior cujo alias colide com a chave
// de outra entrada a sobrescreve silenciosamente (bug PMN -> MOBILIZA, review 2026-06-09).
for (const party of PARTIES) {
  for (const token of [party.sigla, party.nome, ...party.aliases]) {
    const key = normalizePartyValue(token)
    const existing = PARTY_INDEX.get(key)
    if (existing && existing.sigla !== party.sigla) {
      throw new Error(
        `party-canonical: chave "${key}" (de "${token}") colide entre "${existing.sigla}" e "${party.sigla}". ` +
          `Cada sigla/nome/alias normalizado deve mapear para um unico partido canonico.`,
      )
    }
    PARTY_INDEX.set(key, party)
  }
}

export function resolveCanonicalParty(value: string | null | undefined): CanonicalParty | null {
  if (!value || !value.trim()) return null
  return PARTY_INDEX.get(normalizePartyValue(value)) ?? null
}

export function findCanonicalPartyInText(value: string | null | undefined): CanonicalParty | null {
  if (!value || !value.trim()) return null

  const direct = resolveCanonicalParty(value)
  if (direct) return direct

  const normalizedText = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()

  const candidates = PARTIES.flatMap((party) =>
    [party.sigla, party.nome, ...party.aliases].map((candidate) => ({
      party,
      candidate,
      normalized: candidate
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase(),
    }))
  ).sort((left, right) => right.normalized.length - left.normalized.length)

  for (const candidate of candidates) {
    const escaped = candidate.normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern =
      candidate.candidate === candidate.party.sigla
        ? new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i")
        : new RegExp(escaped, "i")
    if (pattern.test(normalizedText)) {
      return candidate.party
    }
  }

  return null
}

export function canonicalPartiesEquivalent(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) return false
  const leftParty = resolveCanonicalParty(left)
  const rightParty = resolveCanonicalParty(right)
  if (!leftParty || !rightParty) return false
  return leftParty.sigla === rightParty.sigla
}
