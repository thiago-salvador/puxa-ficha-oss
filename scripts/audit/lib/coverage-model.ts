/**
 * Régua de cobertura de dados por candidato (2026-08-02).
 *
 * Lógica pura e testável do relatório gerado por `scripts/audit/coverage-report.ts`
 * e conferido por `scripts/audit/check-report.ts`. Nada aqui toca rede ou banco.
 *
 * Cinco estados de célula:
 *   - `ok`      : preenchido (o texto traz a contagem / volume)
 *   - `partial` : preenchido pela metade (vale meio ponto no índice)
 *   - `missing` : esperado e vazio (é o que o gate de lacuna corrigível persegue)
 *   - `zero`    : zero legítimo ou não coletado; o banco não distingue os dois
 *   - `na`      : não se aplica ao candidato, pelo histórico político registrado
 *
 * Aplicabilidade (`na`) é derivada do histórico do próprio site, não de opinião:
 *   - cota parlamentar  : mandato de deputado federal ou senador com fim >= 2009
 *                         (a cota digital do CEAP começa em 2009)
 *   - votações-chave    : mandato federal com fim >= 2012 (janela das 24 votações
 *                         do banco, de 2012-05-25 a 2024-12-10)
 *   - projetos de lei   : mandato parlamentar em qualquer esfera
 *   - legislação exec.  : chefia de Executivo (Presidente, Governador ou Prefeito),
 *                         com `tipo_evento = 'mandato'`
 *   - patrimônio e      : já ter declarado ao TSE, isto é, SQ_CANDIDATO conhecido no
 *     financiamento       seed OU candidatura / mandato ELETIVO no histórico com
 *                         `periodo_inicio <= 2024`. A pré-candidatura de 2026 não
 *                         conta (ainda não houve registro), e cargo por nomeação
 *                         (ministro, secretário, presidência de partido) também não.
 *
 * Histórico incompleto pode gerar falso `na`: é limitação conhecida e está escrita
 * na própria página do relatório.
 */

export type CellState = "ok" | "partial" | "missing" | "zero" | "na"

export interface Cell {
  state: CellState
  text: string
  tip?: string
}

/** Último ano de registro no TSE considerado para "já declarou". */
export const ANO_ULTIMA_ELEICAO_REGISTRADA = 2024
/** Cota parlamentar digital (CEAP) só existe a partir de 2009. */
export const ANO_INICIO_COTA_PARLAMENTAR = 2009
/** Primeira das votações-chave carregadas no banco (2012-05-25). */
export const ANO_INICIO_VOTACOES_CHAVE = 2012
/** Temas do quiz presidencial (`posicoes_declaradas.tema`). */
export const TEMAS_QUIZ = ["reforma_trabalhista", "teto_gastos", "transferencia_renda"] as const

const CARGOS_PARLAMENTAR_FEDERAL = new Set(["Deputado Federal", "Senador"])
const CARGOS_PARLAMENTAR = new Set([
  "Deputado Federal",
  "Senador",
  "Deputado Estadual",
  "Deputado Distrital",
  "Vereador",
])
const CARGOS_CHEFIA_EXECUTIVO = new Set(["Presidente", "Governador", "Prefeito"])
/** Cargos eletivos: disputá-los exige registro de candidatura e declaração de bens ao TSE. */
const CARGOS_ELETIVOS = new Set([
  ...CARGOS_PARLAMENTAR,
  ...CARGOS_CHEFIA_EXECUTIVO,
  "Vice-Presidente",
  "Vice-Governador",
  "Vice-Prefeito",
])

export interface HistoricoEvento {
  cargo_canonico: string | null
  tipo_evento: string | null
  periodo_inicio: number | null
  periodo_fim: number | null
}

export interface CandidatoCoverage {
  slug: string
  nome_urna: string
  partido_sigla: string | null
  cargo_disputado: string | null
  estado: string | null

  foto: boolean
  bio: boolean
  redes: boolean

  /** Idade vem da view pública `candidatos_publico` (a coluna crua é sempre NULL). */
  idade: number | null
  naturalidade: string | null
  formacao: string | null
  profissao: string | null

  historico: HistoricoEvento[]
  /** SQ_CANDIDATO conhecido no seed `data/candidatos.json`. */
  temSqNoSeed: boolean

  mudancas: number
  patrimonioAnos: number[]
  patrimonioAnosComBens: number[]
  financiamentoAnos: number[]
  financiamentoAnosComDoadores: number[]
  votos: number
  contradicoes: number
  processos: number
  alertas: number
  projetos: number
  destaques: number
  gastosAnos: number[]
  legislacaoExecutivo: number
  noticias: number
  /** Temas distintos com posição declarada (o quiz tem 3). */
  posicoesTemas: string[]
  sancoes: number
}

export interface Aplicabilidade {
  cotaParlamentar: boolean
  votacoesChave: boolean
  projetosLei: boolean
  legislacaoExecutivo: boolean
  declarouAoTse: boolean
  /** Foi parlamentar federal alguma vez, mesmo fora da janela das votações. */
  parlamentarFederalQualquerEpoca: boolean
}

function fimEfetivo(evento: HistoricoEvento): number | null {
  // Mandato em curso (`periodo_fim` nulo) conta como corrente: satisfaz qualquer piso.
  if (evento.periodo_fim === null) return Number.POSITIVE_INFINITY
  return evento.periodo_fim
}

export function calcularAplicabilidade(c: CandidatoCoverage): Aplicabilidade {
  const mandatos = c.historico.filter((h) => h.tipo_evento === "mandato")
  const mandatosFederais = mandatos.filter((h) =>
    CARGOS_PARLAMENTAR_FEDERAL.has(h.cargo_canonico ?? "")
  )

  const declarouPorHistorico = c.historico.some((h) => {
    if (!CARGOS_ELETIVOS.has(h.cargo_canonico ?? "")) return false
    if (h.tipo_evento !== "mandato" && h.tipo_evento !== "candidatura") return false
    const inicio = h.periodo_inicio
    return inicio !== null && inicio <= ANO_ULTIMA_ELEICAO_REGISTRADA
  })

  return {
    cotaParlamentar: mandatosFederais.some((h) => {
      const fim = fimEfetivo(h)
      return fim !== null && fim >= ANO_INICIO_COTA_PARLAMENTAR
    }),
    votacoesChave: mandatosFederais.some((h) => {
      const fim = fimEfetivo(h)
      return fim !== null && fim >= ANO_INICIO_VOTACOES_CHAVE
    }),
    projetosLei: mandatos.some((h) => CARGOS_PARLAMENTAR.has(h.cargo_canonico ?? "")),
    legislacaoExecutivo: mandatos.some((h) => CARGOS_CHEFIA_EXECUTIVO.has(h.cargo_canonico ?? "")),
    declarouAoTse: c.temSqNoSeed || declarouPorHistorico,
    parlamentarFederalQualquerEpoca: mandatosFederais.length > 0,
  }
}

export interface ColunaDef {
  key: string
  label: string
}

/** Ordem das colunas na tabela. */
export const COLUNAS: ColunaDef[] = [
  { key: "foto", label: "Foto" },
  { key: "bio", label: "Bio" },
  { key: "redes", label: "Redes sociais" },
  { key: "dados", label: "Dados pessoais" },
  { key: "cargos", label: "Cargos ocupados" },
  { key: "partidos", label: "Hist. partidário" },
  { key: "patrimonio", label: "Patrimônio (anos)" },
  { key: "evolucao", label: "Evolução patrimonial" },
  { key: "bens", label: "Bens ano a ano" },
  { key: "financiamento", label: "Financiamento (anos)" },
  { key: "doadores", label: "Doadores detalhados" },
  { key: "votos", label: "Votações-chave" },
  { key: "contradicoes", label: "Contradições" },
  { key: "processos", label: "Processos judiciais" },
  { key: "alertas", label: "Alertas" },
  { key: "projetos", label: "Projetos de lei" },
  { key: "destaques", label: "Proj. em destaque" },
  { key: "gastos", label: "Cota parlamentar" },
  { key: "legexec", label: "Legislação do Executivo" },
  { key: "noticias", label: "Notícias" },
  { key: "posicoes", label: "Posições (quiz)" },
  { key: "sancoes", label: "Sanções" },
]

/** As 15 colunas que entram no índice de preenchimento. */
export const COLUNAS_DO_INDICE = [
  "foto",
  "bio",
  "redes",
  "dados",
  "patrimonio",
  "evolucao",
  "bens",
  "financiamento",
  "doadores",
  "votos",
  "projetos",
  "gastos",
  "legexec",
  "noticias",
  "posicoes",
] as const

function cell(state: CellState, text: string, tip?: string): Cell {
  return tip ? { state, text, tip } : { state, text }
}

function anos(n: number): string {
  return `${n} ano${n > 1 ? "s" : ""}`
}

export function calcularCelulas(c: CandidatoCoverage): Record<string, Cell> {
  const ap = calcularAplicabilidade(c)
  const out: Record<string, Cell> = {}

  out.foto = c.foto ? cell("ok", "✓") : cell("missing", "—")
  out.bio = c.bio ? cell("ok", "✓") : cell("missing", "—")
  out.redes = c.redes ? cell("ok", "✓") : cell("missing", "—")

  const dp = [c.idade !== null, Boolean(c.naturalidade), Boolean(c.formacao), Boolean(c.profissao)]
    .filter(Boolean).length
  out.dados = cell(
    dp >= 3 ? "ok" : dp >= 1 ? "partial" : "missing",
    `${dp}/4`,
    "idade (view pública), naturalidade, formação, profissão"
  )

  const mandatos = c.historico.filter((h) => h.tipo_evento === "mandato").length
  out.cargos =
    mandatos > 0 ? cell("ok", String(mandatos)) : cell("zero", "0", "nenhum mandato registrado")
  out.partidos =
    c.mudancas > 0 ? cell("ok", String(c.mudancas)) : cell("zero", "0", "sem troca registrada")

  const pat = c.patrimonioAnos.length
  if (pat > 0) {
    out.patrimonio = cell("ok", anos(pat))
    out.evolucao =
      pat >= 2 ? cell("ok", "✓") : cell("partial", "1 ano", "evolução precisa de 2 anos ou mais")
    const bens = c.patrimonioAnosComBens.length
    out.bens = cell(bens === pat ? "ok" : bens > 0 ? "partial" : "missing", `${bens}/${pat}`)
  } else if (!ap.declarouAoTse) {
    const tip = "nunca disputou eleição nem teve mandato eletivo: não há declaração ao TSE"
    out.patrimonio = cell("na", "n/a", tip)
    out.evolucao = cell("na", "n/a", tip)
    out.bens = cell("na", "n/a", tip)
  } else {
    out.patrimonio = cell("missing", "—")
    out.evolucao = cell("missing", "—")
    out.bens = cell("missing", "—")
  }

  const fin = c.financiamentoAnos.length
  if (fin > 0) {
    out.financiamento = cell("ok", anos(fin))
    const d = c.financiamentoAnosComDoadores.length
    out.doadores = cell(d === fin ? "ok" : d > 0 ? "partial" : "missing", `${d}/${fin}`)
  } else if (!ap.declarouAoTse) {
    const tip = "nunca disputou eleição nem teve mandato eletivo: não há prestação de contas ao TSE"
    out.financiamento = cell("na", "n/a", tip)
    out.doadores = cell("na", "n/a", tip)
  } else {
    out.financiamento = cell("missing", "—")
    out.doadores = cell("missing", "—")
  }

  if (c.votos > 0) {
    out.votos = cell("ok", String(c.votos))
  } else if (ap.votacoesChave) {
    out.votos = cell(
      "missing",
      "—",
      `mandato federal dentro da janela das votações-chave (${ANO_INICIO_VOTACOES_CHAVE}-2024), sem voto registrado`
    )
  } else if (ap.parlamentarFederalQualquerEpoca) {
    out.votos = cell(
      "na",
      "n/a",
      `mandato federal encerrado antes de ${ANO_INICIO_VOTACOES_CHAVE}, fora da janela das votações-chave`
    )
  } else {
    out.votos = cell("na", "n/a", "nunca foi deputado federal ou senador (pelo histórico registrado)")
  }

  out.contradicoes =
    c.contradicoes > 0
      ? cell("ok", String(c.contradicoes))
      : cell("zero", "0", "nenhuma contradição registrada")
  out.processos =
    c.processos > 0 ? cell("ok", String(c.processos)) : cell("zero", "0", "nenhum processo registrado")
  out.alertas =
    c.alertas > 0 ? cell("ok", String(c.alertas)) : cell("zero", "0", "nenhum ponto de atenção público")

  if (c.projetos > 0) {
    out.projetos = cell("ok", String(c.projetos))
    out.destaques =
      c.destaques > 0
        ? cell("ok", String(c.destaques))
        : cell("partial", "0", "tem projetos, sem curadoria de destaque")
  } else if (ap.projetosLei) {
    out.projetos = cell("missing", "—", "teve mandato parlamentar, sem projeto registrado")
    out.destaques = cell("missing", "—")
  } else {
    const tip = "nunca exerceu mandato parlamentar (pelo histórico registrado)"
    out.projetos = cell("na", "n/a", tip)
    out.destaques = cell("na", "n/a", tip)
  }

  const g = c.gastosAnos.length
  if (g > 0) {
    out.gastos = cell("ok", anos(g))
  } else if (ap.cotaParlamentar) {
    out.gastos = cell("missing", "—", "mandato federal na era do CEAP digital, sem cota registrada")
  } else if (ap.parlamentarFederalQualquerEpoca) {
    out.gastos = cell(
      "na",
      "n/a",
      `mandato federal encerrado antes de ${ANO_INICIO_COTA_PARLAMENTAR}, quando a cota digital (CEAP) ainda não existia`
    )
  } else {
    out.gastos = cell("na", "n/a", "cota parlamentar só existe para deputado federal ou senador")
  }

  if (c.legislacaoExecutivo > 0) {
    out.legexec = cell("ok", String(c.legislacaoExecutivo))
  } else if (ap.legislacaoExecutivo) {
    out.legexec = cell("missing", "—", "chefiou Executivo, sem norma registrada")
  } else {
    out.legexec = cell(
      "na",
      "n/a",
      "nunca chefiou Executivo (presidente, governador ou prefeito)"
    )
  }

  out.noticias = c.noticias > 0 ? cell("ok", String(c.noticias)) : cell("missing", "—")

  if (c.cargo_disputado === "Presidente") {
    const n = c.posicoesTemas.length
    const total = TEMAS_QUIZ.length
    out.posicoes = cell(
      n >= total ? "ok" : n > 0 ? "partial" : "missing",
      `${n}/${total}`,
      n >= total ? undefined : "quiz presidencial com tema sem posição declarada"
    )
  } else {
    out.posicoes = cell("na", "n/a", "quiz cobre só a disputa presidencial")
  }

  out.sancoes =
    c.sancoes > 0 ? cell("ok", String(c.sancoes)) : cell("zero", "0", "nenhuma sanção registrada")

  return out
}

/** Índice de preenchimento: só colunas aplicáveis; `partial` vale meio ponto. */
export function calcularIndice(celulas: Record<string, Cell>): number {
  let total = 0
  let obtido = 0
  for (const key of COLUNAS_DO_INDICE) {
    const c = celulas[key]
    if (!c || c.state === "na") continue
    total += 1
    if (c.state === "ok") obtido += 1
    else if (c.state === "partial") obtido += 0.5
  }
  return total === 0 ? 0 : Math.round((100 * obtido) / total)
}
