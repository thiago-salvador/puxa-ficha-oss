/**
 * Relatório de cobertura de dados por candidato (2026-08-02).
 *
 * Mede **o que o leitor vê em puxaficha.com.br**, não o que existe no banco.
 * Onde os dois divergem, vale a superfície pública:
 *   - posição só conta quando `verificado = true`, que é o filtro do quiz;
 *   - destaque só conta quando cai nos 25 projetos que a ficha carrega;
 *   - ponto de atenção só conta quando `visivel = true`.
 * O que está no banco esperando decisão humana não vira verde: vira item na
 * coluna "Aguardando aprovação", com página própria para aprovar ou rejeitar.
 *
 * A régua (cinco estados de célula, aplicabilidade, índice de 15 colunas) vive
 * em `lib/coverage-model.ts`; este arquivo só monta e desenha.
 *
 * Não escreve em banco. Os efeitos colaterais são o HTML de saída, o JSON irmão
 * (com `--json`) e as páginas de revisão em `<dir do HTML>/revisao/`.
 *
 * A entrada é sempre o snapshot JSON de `coverage-snapshot.sql`, rodado contra o
 * banco em modo somente leitura. Sem `--from-snapshot`, o próprio script executa
 * o .sql pela Management API do Supabase (`lib/snapshot-fetch.ts`, sempre com
 * `read_only: true`) e guarda o resultado em disco. Isso não reabre o caminho
 * removido em 02/08: o SQL continua sendo a única descrição dos fatos, o script
 * só o transporta. Com `--from-snapshot` nada de rede acontece, que é o modo
 * usado por teste e por quem não tem credencial.
 *
 * Uso:
 *   npm run audit:cobertura                    # busca o snapshot e desenha
 *   tsx scripts/audit/coverage-report.ts --from-snapshot=snapshot.json --json
 *   tsx scripts/audit/coverage-report.ts --from-snapshot=snapshot.json --com-migrations-pendentes
 *
 * Flags:
 *   --from-snapshot=PATH        pula a leitura do banco e usa este JSON
 *   --snapshot-out=PATH         onde gravar o snapshot buscado
 *                               (default: <out sem .html>-snapshot.json)
 *   --out=PATH                  caminho do HTML (default: ~/.disposable-html/AAAA-MM-DD-puxa-ficha-cobertura-dados.descartavel.html)
 *   --json[=PATH]               grava também o JSON de estados por célula
 *   --review-post=URL           endpoint para onde as páginas de revisão enviam
 *                               as decisões (default: /revisao)
 *   --evidence=PATH             anexa ao HTML a prova de DOM, banco e viewport
 *   --com-migrations-pendentes  sobrepõe o efeito das migrations anotadas com
 *                               `-- @write` que ainda não foram aplicadas
 *   --migrations-desde=PREFIXO  restringe a varredura de migrations pendentes
 *   --slugs=a,b,c               limita o relatório a esses slugs
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { homedir } from "node:os"

import type { CandidatoConfig } from "../lib/types"
import { readFileSync } from "node:fs"
import {
  COLUNAS,
  ROTULO_CLASSE,
  ROTULO_PROVENIENCIA,
  calcularCelulas,
  calcularFontesNaoAplicaveis,
  calcularIndice,
  type CandidatoCoverage,
  type Cell,
  type ColetaPorFonte,
  type ItemRevisar
} from "./lib/coverage-model"
import {
  FONTES_POR_CANDIDATO,
  ROTULO_RESULTADO_FONTE,
  linhasPorFonte,
  type ResultadoFonte
} from "./lib/coleta-proveniencia"
import { lerPendingWrites, type PendingWrite } from "./lib/pending-writes"
import { obterSnapshot } from "./lib/snapshot-fetch"

const RAIZ = resolve(import.meta.dirname, "..", "..")

const UF_NOME: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AM: "Amazonas",
  AP: "Amapá",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MG: "Minas Gerais",
  MS: "Mato Grosso do Sul",
  MT: "Mato Grosso",
  PA: "Pará",
  PB: "Paraíba",
  PE: "Pernambuco",
  PI: "Piauí",
  PR: "Paraná",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RO: "Rondônia",
  RR: "Roraima",
  RS: "Rio Grande do Sul",
  SC: "Santa Catarina",
  SE: "Sergipe",
  SP: "São Paulo",
  TO: "Tocantins"
}

// ── CLI ────────────────────────────────────────────────────────────

interface Opcoes {
  out: string
  json: string | null
  comPendentes: boolean
  migrationsDesde?: string
  slugs?: Set<string>
  fromSnapshot?: string
  snapshotOut: string
  reviewPost: string
  evidence?: string
}

type ValorEvidencia = string | number | boolean | null

export type CategoriaResiduo =
  | "N/A"
  | "fonte indisponível"
  | "identidade sem prova"
  | "curadoria em andamento"
  | "aguardando aprovação"
  | "busca esgotada no escopo"
  | "erro de código ainda aberto"

export interface LinhaReconciliacao {
  chave?: string
  nome?: string
  slug?: string
  coluna?: string
  fonte?: string
  candidato?: string
  celula?: string
  consulta?: string
  antes?: ValorEvidencia
  depois?: ValorEvidencia
  delta?: number
  transicao?: string
  tipo?: string
  categoria?: string
  detalhe?: string
  proxima_acao?: string
}

type TabelaReconciliacao =
  | LinhaReconciliacao[]
  | Record<string, LinhaReconciliacao | ValorEvidencia>

export interface ResiduoReconciliacao {
  categoria?: CategoriaResiduo
  total?: number
  resumo?: string
  motivo?: string
  proxima_acao?: string
  itens?: LinhaReconciliacao[]
}

export interface ReconciliacaoEvidencia {
  passou?: boolean
  totais?: {
    antes?: Record<string, number>
    depois?: Record<string, number>
  }
  /** Alias aceito para produtores que gravam os lados diretamente. */
  antes?: Record<string, number>
  depois?: Record<string, number>
  resumo?: {
    zerou?: string[]
    mudou_categoria?: string[]
    depende_aprovacao?: string[]
    continua_impossivel?: string[]
  }
  por_coluna?: TabelaReconciliacao
  por_fonte?: TabelaReconciliacao
  por_candidato?: TabelaReconciliacao
  por_celula?: TabelaReconciliacao
  por_consulta_fonte_candidato?: TabelaReconciliacao
  transicoes?: LinhaReconciliacao[]
  residuos?:
    | ResiduoReconciliacao[]
    | Partial<Record<CategoriaResiduo, ResiduoReconciliacao | LinhaReconciliacao[]>>
  proximas_acoes?: {
    id: string
    rotulo: string
    descricao?: string
    recomendada?: boolean
  }[]
}

export interface EvidenciaRelatorio {
  verificado_em: string
  regua: {
    candidatos_antes: number
    candidatos_depois: number
    total_celulas_alteradas: number
    por_coluna: Record<string, number>
    passou: boolean
  }
  dom: {
    total_legenda: number
    total_dom: number
    por_estado: Record<string, { legenda: number; dom: number }>
    passou: boolean
  }
  fontes: {
    slug: string
    nome_urna: string
    linhas_select: number
    linhas_relatorio: number
    divergencias: number
    passou: boolean
  }[]
  mobile: {
    viewport_largura: number
    document_scroll_width: number
    document_client_width: number
    tabelas_com_overflow: number
    passou: boolean
  }
  reconciliacao?: ReconciliacaoEvidencia
}

/**
 * Data local, não UTC. Rodando de madrugada em São Paulo, `toISOString` já
 * virou o dia e o arquivo saía com data de amanhã enquanto o corpo do relatório
 * (que usa `toLocaleDateString`) dizia hoje. Nome e conteúdo têm que combinar:
 * o nome do arquivo é a única coisa que sobrevive na pasta de descartáveis.
 */
function hoje(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function parseArgs(argv: string[]): Opcoes {
  const get = (nome: string): string | undefined => {
    const hit = argv.find((a) => a === `--${nome}` || a.startsWith(`--${nome}=`))
    if (!hit) return undefined
    const idx = hit.indexOf("=")
    return idx === -1 ? "" : hit.slice(idx + 1)
  }

  const out =
    get("out") ||
    join(homedir(), ".disposable-html", `${hoje()}-puxa-ficha-cobertura-dados.descartavel.html`)
  const jsonFlag = get("json")
  const slugs = get("slugs")

  return {
    out,
    json: jsonFlag === undefined ? null : jsonFlag || out.replace(/\.html$/, "") + ".json",
    comPendentes: get("com-migrations-pendentes") !== undefined,
    migrationsDesde: get("migrations-desde") || undefined,
    slugs: slugs
      ? new Set(
          slugs
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        )
      : undefined,
    fromSnapshot: get("from-snapshot") || undefined,
    snapshotOut: get("snapshot-out") || out.replace(/\.html$/, "") + "-snapshot.json",
    reviewPost: get("review-post") || "/revisao",
    evidence: get("evidence") || undefined
  }
}

// ── Leitura do snapshot ─────────────────────────────────────────────
//
// Fonte única: o JSON produzido por `coverage-snapshot.sql`. O caminho que lia
// o banco direto pelo supabase-js foi removido em 2026-08-02, quando a régua
// passou a medir "o que o leitor vê": as regras novas (destaque dentro da fatia
// de 25 projetos que a ficha carrega, posição só com verificado = true, fila de
// revisão) são janelas e uniões que ficavam ilegíveis reimplementadas em JS, e
// manter as duas versões em sincronia era convite a duas verdades.

/** IDs oficiais conhecidos no seed `data/candidatos.json`, por slug. */
function idsOficiaisNoSeed(): Map<
  string,
  { temSq: boolean; temCamara: boolean; temSenado: boolean }
> {
  const seed: CandidatoConfig[] = JSON.parse(
    readFileSync(join(RAIZ, "data", "candidatos.json"), "utf8")
  )
  return new Map(
    seed.map((c) => {
      const sq = c.ids?.tse_sq_candidato
      return [
        c.slug,
        {
          temSq: Boolean(sq && Object.values(sq).some(Boolean)),
          temCamara: c.ids?.camara !== null && c.ids?.camara !== undefined,
          temSenado: c.ids?.senado !== null && c.ids?.senado !== undefined
        }
      ]
    })
  )
}

/**
 * Lê o snapshot gerado por `coverage-snapshot.sql`. O SQL não conhece o seed do
 * repo, então os IDs de TSE, Câmara e Senado são resolvidos aqui.
 *
 * O campo `coleta` do SQL vira `coletas` no modelo. Ele pode não existir, e a
 * diferença importa: snapshot antigo (gravado antes da migration `coleta_log`,
 * ou lido de banco que ainda não a recebeu) não traz a chave, e aí `coletas`
 * fica `undefined`, que o modelo lê como "procedência não lida". Snapshot novo
 * de candidato sem tentativa nenhuma traz `{}`, que é "nunca verificado". São
 * afirmações diferentes e a leitura precisa preservar as duas.
 */
export function lerSnapshot(path: string, slugs?: Set<string>): CandidatoCoverage[] {
  const bruto = JSON.parse(readFileSync(path, "utf8")) as (Omit<
    CandidatoCoverage,
    "temSqNoSeed" | "temIdCamaraNoSeed" | "temIdSenadoNoSeed" | "coletas"
  > & { coleta?: ColetaPorFonte })[]
  const idsNoSeed = idsOficiaisNoSeed()
  return bruto
    .filter((c) => (slugs ? slugs.has(c.slug) : true))
    .map(({ coleta, ...c }) => {
      const ids = idsNoSeed.get(c.slug)
      return {
        ...c,
        temSqNoSeed: ids?.temSq ?? false,
        temIdCamaraNoSeed: ids?.temCamara ?? false,
        temIdSenadoNoSeed: ids?.temSenado ?? false,
        coletas: coleta
      }
    })
}

// ── Overlay das migrations pendentes ────────────────────────────────

export function aplicarPendentes(
  coorte: CandidatoCoverage[],
  writes: PendingWrite[]
): { coorte: CandidatoCoverage[]; aplicados: number } {
  const porSlug = new Map(coorte.map((c) => [c.slug, { ...c }]))
  let aplicados = 0

  const push = (arr: number[], valor: number): number[] =>
    arr.includes(valor) ? arr : [...arr, valor]

  for (const w of writes) {
    const c = porSlug.get(w.slug)
    if (!c) continue
    aplicados += 1

    if (w.tabela === "patrimonio" && w.ano !== undefined) {
      c.patrimonioAnos = push(c.patrimonioAnos, w.ano)
      if (w.campos.includes("bens")) c.patrimonioAnosComBens = push(c.patrimonioAnosComBens, w.ano)
    } else if (w.tabela === "financiamento" && w.ano !== undefined) {
      c.financiamentoAnos = push(c.financiamentoAnos, w.ano)
      if (w.campos.includes("maiores_doadores")) {
        c.financiamentoAnosComDoadores = push(c.financiamentoAnosComDoadores, w.ano)
      }
    } else if (w.tabela === "posicoes_declaradas" && w.tema) {
      // Migration de posição grava `verificado = false`, então o efeito no site
      // é nenhum até a revisão humana: entra na fila de pendentes, não no quiz.
      if (!c.posicoesTemasPendentes.includes(w.tema)) {
        c.posicoesTemasPendentes = [...c.posicoesTemasPendentes, w.tema]
      }
    } else if (w.tabela === "projetos_lei" && w.campos.includes("destaque")) {
      c.destaquesTotais += 1
    } else if (w.tabela === "votos_candidato") {
      c.votos += 1
    } else if (w.tabela === "candidatos" && w.campos.includes("profissao_declarada")) {
      c.profissao = c.profissao ?? "(preenchido por migration pendente)"
    }
  }

  return { coorte: [...porSlug.values()], aplicados }
}

// ── Render ──────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderTabela(
  coorte: CandidatoCoverage[],
  id: string,
  matriz: ReadonlyMap<string, Record<string, Cell>>
): string {
  const ths = COLUNAS.map((c) => `<th><span class="rot">${esc(c.label)}</span></th>`).join("")
  const acumulado = new Map(COLUNAS.map((c) => [c.key, { got: 0, tot: 0 }]))
  const linhas: string[] = []

  for (const cand of [...coorte].sort((a, b) => a.nome_urna.localeCompare(b.nome_urna, "pt-BR"))) {
    const celulas = matriz.get(cand.slug)!
    const indice = calcularIndice(celulas)
    const tds = COLUNAS.map(({ key }) => {
      const cel: Cell = celulas[key]
      const tip = cel.tip ? ` title="${esc(cel.tip)}"` : ""
      const acc = acumulado.get(key)!
      if (cel.state !== "na") {
        acc.tot += 1
        if (cel.state === "ok") acc.got += 1
        else if (cel.state === "partial") acc.got += 0.5
      }
      // A célula de revisão vira link para a página de decisão do candidato.
      const conteudo =
        key === "revisar" && cand.itensRevisar.length > 0
          ? `<a class="rev" href="revisao/${esc(cand.slug)}.html">${esc(cel.text)}</a>`
          : esc(cel.text)
      // Zero com procedência conhecida ganha um traço embaixo: contínuo quando
      // a fonte respondeu vazio, pontilhado quando ninguém foi verificar.
      const prov = cel.proveniencia ? ` data-prov="${esc(cel.proveniencia)}"` : ""
      return `<td class="c-${cel.state}" data-slug="${esc(cand.slug)}" data-col="${esc(key)}"${prov}${tip}>${conteudo}</td>`
    }).join("")

    const classeIndice = indice >= 80 ? "s-hi" : indice >= 50 ? "s-mid" : "s-lo"
    linhas.push(
      `<tr data-slug="${esc(cand.slug)}"><th scope="row" class="cand">` +
        `<a href="https://puxaficha.com.br/candidato/${esc(cand.slug)}" target="_blank" rel="noopener">${esc(cand.nome_urna)}</a>` +
        `<span class="party">${esc(cand.partido_sigla ?? "—")}</span></th>` +
        `<td class="scr ${classeIndice}" data-slug="${esc(cand.slug)}" data-col="indice">${indice}%</td>` +
        tds +
        `</tr>`
    )
  }

  const foot = COLUNAS.map(({ key }) => {
    const { got, tot } = acumulado.get(key)!
    return `<td class="agg">${tot ? `${Math.round((100 * got) / tot)}%` : "·"}</td>`
  }).join("")

  return (
    `<div class="twrap"><table id="${id}">` +
    `<thead><tr><th class="cand">Candidato</th><th><span class="rot">Preenchimento</span></th>${ths}</tr></thead>` +
    `<tbody>${linhas.join("")}</tbody>` +
    `<tfoot><tr><th class="cand agg">% com dado (dos aplicáveis)</th><td class="agg"></td>${foot}</tr></tfoot>` +
    `</table></div>`
  )
}

const ORDEM_RESULTADO_FONTE: Record<ResultadoFonte, number> = {
  nunca_verificado: 0,
  erro: 1,
  indeterminado: 2,
  sem_achado_no_escopo: 3,
  vazio_confirmado: 4,
  nao_aplicavel: 5,
  encontrado: 6
}

function dataHoraColeta(valor: string | undefined): string {
  if (!valor) return "—"
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return valor
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(data)
}

/**
 * Segundo eixo do relatório: cada linha responde por uma fonte e um candidato.
 * A lista vem do registro canônico dos ingests; a célula de cobertura continua
 * sendo calculada exclusivamente por `coverage-model.ts`.
 */
function renderTabelaFontes(coorte: CandidatoCoverage[], id: string): string {
  const linhas: string[] = []
  const candidatos = [...coorte].sort((a, b) => a.nome_urna.localeCompare(b.nome_urna, "pt-BR"))

  for (const cand of candidatos) {
    if (cand.coletas === undefined) {
      linhas.push(
        `<tr data-slug="${esc(cand.slug)}"><th scope="row" class="fonte-cand">${esc(
          cand.nome_urna
        )}<span class="party">${esc(cand.partido_sigla ?? "—")}</span></th>` +
          `<td colspan="5" class="fonte-indisponivel">Log de coleta não lido neste snapshot.</td></tr>`
      )
      continue
    }

    const fontes = linhasPorFonte(cand.coletas, calcularFontesNaoAplicaveis(cand)).sort(
      (a, b) =>
        ORDEM_RESULTADO_FONTE[a.resultado] - ORDEM_RESULTADO_FONTE[b.resultado] ||
        a.fonte.localeCompare(b.fonte, "pt-BR")
    )
    const nunca = fontes.filter((f) => f.resultado === "nunca_verificado").length

    fontes.forEach((fonte, indice) => {
      const candidato =
        indice === 0
          ? `<th scope="rowgroup" rowspan="${fontes.length}" class="fonte-cand">` +
            `<a href="https://puxaficha.com.br/candidato/${esc(cand.slug)}" target="_blank" rel="noopener">${esc(cand.nome_urna)}</a>` +
            `<span class="party">${esc(cand.partido_sigla ?? "—")}</span>` +
            `<span class="faltam ${nunca === 0 ? "completo" : ""}">${nunca} nunca verificada${nunca === 1 ? "" : "s"}</span></th>`
          : ""
      const resultado = ROTULO_RESULTADO_FONTE[fonte.resultado]
      const detalhe = fonte.detalhe ? esc(fonte.detalhe) : "—"
      const volume = fonte.resultado === "encontrado" ? String(fonte.volume ?? "—") : "—"
      const data = dataHoraColeta(fonte.executado_em)
      const time = fonte.executado_em
        ? `<time datetime="${esc(fonte.executado_em)}">${esc(data)}</time>`
        : "—"

      linhas.push(
        `<tr data-slug="${esc(cand.slug)}" data-source="${esc(fonte.fonte)}" data-result="${esc(
          fonte.resultado
        )}">${candidato}` +
          `<td class="fonte-nome"><code>${esc(fonte.fonte)}</code></td>` +
          `<td class="resultado r-${esc(fonte.resultado)}">${esc(resultado)}</td>` +
          `<td class="volume">${esc(volume)}</td>` +
          `<td class="data">${time}</td>` +
          `<td class="detalhe" title="${detalhe}">${detalhe}</td></tr>`
      )
    })
  }

  return (
    `<div class="fonte-intro"><h3>Por fonte, por candidato</h3>` +
    `<p>Uma linha por fonte de escopo candidato. As não consultadas aparecem primeiro; fontes adicionais já observadas no log também entram.</p></div>` +
    `<div class="twrap fontes-wrap"><table id="${id}" class="fontes">` +
    `<thead><tr><th class="fonte-cand">Candidato</th><th>Fonte</th><th>Desfecho</th><th>Volume</th><th>Última tentativa</th><th>Detalhe</th></tr></thead>` +
    `<tbody>${linhas.join("")}</tbody></table></div>`
  )
}

const CATEGORIAS_RESIDUO: readonly CategoriaResiduo[] = [
  "N/A",
  "fonte indisponível",
  "identidade sem prova",
  "curadoria em andamento",
  "aguardando aprovação",
  "busca esgotada no escopo",
  "erro de código ainda aberto"
]

function rotuloChave(chave: string): string {
  return chave.replaceAll("_", " ").replace(/^./, (letra) => letra.toUpperCase())
}

function valorEvidencia(valor: ValorEvidencia | undefined): string {
  if (valor === undefined || valor === null || valor === "") return "não informado"
  if (typeof valor === "number") return valor.toLocaleString("pt-BR")
  if (typeof valor === "boolean") return valor ? "sim" : "não"
  return esc(String(valor))
}

function linhasDaTabela(tabela: TabelaReconciliacao | undefined): LinhaReconciliacao[] {
  if (!tabela) return []
  if (Array.isArray(tabela)) return tabela
  return Object.entries(tabela).map(([chave, valor]) =>
    valor !== null && typeof valor === "object"
      ? { chave, ...(valor as LinhaReconciliacao) }
      : { chave, depois: valor as ValorEvidencia }
  )
}

function chaveDaLinha(linha: LinhaReconciliacao): string {
  const composta = [linha.slug ?? linha.candidato, linha.coluna ?? linha.fonte]
    .filter(Boolean)
    .join(" · ")
  const explicita =
    linha.chave ??
    linha.nome ??
    linha.celula ??
    linha.consulta
  return explicita ?? (composta || "não informado")
}

function mudancaDaLinha(linha: LinhaReconciliacao): string {
  if (linha.transicao) return esc(linha.transicao)
  if (linha.delta !== undefined) {
    const delta = linha.delta
    return `${delta > 0 ? "+" : ""}${delta.toLocaleString("pt-BR")}`
  }
  if (typeof linha.antes === "number" && typeof linha.depois === "number") {
    const delta = linha.depois - linha.antes
    return `${delta > 0 ? "+" : ""}${delta.toLocaleString("pt-BR")}`
  }
  return "não informada"
}

function renderTabelaReconciliacao(
  titulo: string,
  tabela: TabelaReconciliacao | undefined,
  aberta = false
): string {
  const linhas = linhasDaTabela(tabela)
  if (linhas.length === 0) return ""
  const corpo = linhas
    .map(
      (linha) =>
        `<tr><th scope="row"><code>${esc(chaveDaLinha(linha))}</code></th>` +
        `<td>${valorEvidencia(linha.antes)}</td><td>${valorEvidencia(linha.depois)}</td>` +
        `<td>${mudancaDaLinha(linha)}</td><td>${valorEvidencia(
          linha.categoria ?? linha.tipo
        )}</td><td>${valorEvidencia(linha.detalhe)}</td>` +
        `<td>${valorEvidencia(linha.proxima_acao)}</td></tr>`
    )
    .join("")
  return `<details class="recon-details"${aberta ? " open" : ""}>
<summary>${esc(titulo)} <span class="count">${linhas.length.toLocaleString("pt-BR")}</span></summary>
<div class="recon-table-wrap"><table class="recon-table" data-page-size="50">
<thead><tr><th>Item</th><th>Antes</th><th>Depois</th><th>Delta ou transição</th><th>Categoria</th><th>Detalhe</th><th>Próxima ação</th></tr></thead>
<tbody>${corpo}</tbody></table></div>
</details>`
}

function residuosDaReconciliacao(
  reconciliacao: ReconciliacaoEvidencia
): Map<CategoriaResiduo, ResiduoReconciliacao> {
  const mapa = new Map<CategoriaResiduo, ResiduoReconciliacao>()
  const residuos = reconciliacao.residuos
  if (Array.isArray(residuos)) {
    for (const residuo of residuos) {
      if (residuo.categoria && CATEGORIAS_RESIDUO.includes(residuo.categoria)) {
        mapa.set(residuo.categoria, residuo)
      }
    }
  } else if (residuos) {
    for (const categoria of CATEGORIAS_RESIDUO) {
      const valor = residuos[categoria]
      if (Array.isArray(valor)) mapa.set(categoria, { categoria, itens: valor })
      else if (valor) mapa.set(categoria, { categoria, ...valor })
    }
  }
  return mapa
}

function renderListaResumo(itens: string[] | undefined): string {
  if (!itens?.length) return `<p class="nao-informado">Não informado na evidência.</p>`
  return `<ul>${itens.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
}

function renderReconciliacao(evidencia: EvidenciaRelatorio): string {
  const reconciliacao = evidencia.reconciliacao
  if (!reconciliacao) return ""

  const antes = reconciliacao.totais?.antes ?? reconciliacao.antes ?? {}
  const depois = reconciliacao.totais?.depois ?? reconciliacao.depois ?? {}
  const chavesTotais = [...new Set([...Object.keys(antes), ...Object.keys(depois)])]
  const totais = chavesTotais
    .map((chave) => {
      const a = antes[chave]
      const d = depois[chave]
      const delta = a === undefined || d === undefined ? "não informado" : d - a
      return `<tr><th scope="row">${esc(rotuloChave(chave))}</th><td>${valorEvidencia(
        a
      )}</td><td>${valorEvidencia(d)}</td><td>${valorEvidencia(delta)}</td></tr>`
    })
    .join("")

  const zerouDerivado = chavesTotais
    .filter((chave) => (antes[chave] ?? 0) > 0 && depois[chave] === 0)
    .map((chave) => `${rotuloChave(chave)}: ${antes[chave].toLocaleString("pt-BR")} → 0`)
  const resumo = reconciliacao.resumo
  const residuos = residuosDaReconciliacao(reconciliacao)

  const cardsResumo = [
    ["O que zerou", resumo?.zerou ?? zerouDerivado],
    ["O que apenas mudou de categoria", resumo?.mudou_categoria],
    ["O que depende de aprovação", resumo?.depende_aprovacao],
    ["O que continua impossível e por quê", resumo?.continua_impossivel]
  ] as const

  const cardsResiduo = CATEGORIAS_RESIDUO.map((categoria) => {
    const residuo = residuos.get(categoria)
    if (!residuo) {
      return `<article class="residuo" data-categoria="${esc(categoria)}"><h4>${esc(
        categoria
      )}</h4><p class="nao-informado">Sem registro nesta categoria na evidência.</p></article>`
    }
    const total = residuo.total === undefined ? "" : `<b class="residuo-total">${residuo.total.toLocaleString("pt-BR")}</b>`
    const descricao = residuo.resumo ?? residuo.motivo
    const itens = residuo.itens?.length
      ? renderTabelaReconciliacao("Itens desta categoria", residuo.itens)
      : ""
    return `<article class="residuo" data-categoria="${esc(categoria)}"><h4>${esc(
      categoria
    )}${total}</h4>${descricao ? `<p>${esc(descricao)}</p>` : ""}<p><b>Próxima ação:</b> ${
      residuo.proxima_acao ? esc(residuo.proxima_acao) : "não informada na evidência"
    }.</p>${itens}</article>`
  }).join("")

  const aguardando = residuos.get("aguardando aprovação")
  const acoes = reconciliacao.proximas_acoes?.length
    ? reconciliacao.proximas_acoes
    : [
        {
          id: "seguir-acoes-relatorio",
          rotulo: "Seguir as próximas ações registradas",
          descricao: "Executar cada resíduo dentro do limite e da fonte indicados no relatório.",
          recomendada: true
        },
        {
          id: "priorizar-aprovacoes",
          rotulo: "Priorizar aprovações pendentes",
          descricao: "Revisar primeiro os itens que dependem de decisão humana."
        },
        {
          id: "manter-bloqueios-abertos",
          rotulo: "Manter bloqueios abertos",
          descricao: "Não converter fonte indisponível, identidade sem prova ou erro em sucesso."
        }
      ]
  const recomendada = acoes.findIndex((acao) => acao.recomendada)
  const opcoes = acoes
    .map(
      (acao, indice) =>
        `<label class="acao-opcao"><input type="radio" name="acao-c7" value="${esc(
          acao.id
        )}" ${indice === (recomendada >= 0 ? recomendada : 0) ? "checked" : ""}>` +
        `<span><b>${esc(acao.rotulo)}${acao.recomendada ? " · Recomendado" : ""}</b>${
          acao.descricao ? `<small>${esc(acao.descricao)}</small>` : ""
        }</span></label>`
    )
    .join("")

  return `<section class="reconciliacao" id="reconciliacao">
<div class="section-head"><div><p class="eyebrow">C7 · reconciliação final</p><h2>O que mudou, o que não mudou e o que ainda bloqueia</h2></div>${
    reconciliacao.passou === undefined
      ? ""
      : `<b class="selo ${reconciliacao.passou ? "passou" : "falhou"}">${
          reconciliacao.passou ? "PASSOU" : "PARCIAL OU BLOQUEADO"
        }</b>`
  }</div>
<p class="notes">Os números abaixo vêm do JSON de evidência. Redução legítima, mudança de categoria e bloqueio permanecem separados.</p>
${
  totais
    ? `<div class="recon-table-wrap totais"><table><thead><tr><th>Métrica</th><th>Antes</th><th>Depois</th><th>Delta</th></tr></thead><tbody>${totais}</tbody></table></div>`
    : `<p class="nao-informado">Totais antes/depois não informados na evidência.</p>`
}
<div class="summary-grid">${cardsResumo
    .map(
      ([titulo, itens]) =>
        `<article><h3>${esc(titulo)}</h3>${renderListaResumo(itens as string[] | undefined)}</article>`
    )
    .join("")}</div>

<h3 class="subsection-title">Detalhamento antes/depois</h3>
${renderTabelaReconciliacao("Por coluna", reconciliacao.por_coluna, true)}
${renderTabelaReconciliacao("Por fonte", reconciliacao.por_fonte)}
${renderTabelaReconciliacao("Por candidato", reconciliacao.por_candidato)}
${renderTabelaReconciliacao("Por célula", reconciliacao.por_celula)}
${renderTabelaReconciliacao(
  "Por consulta fonte-candidato",
  reconciliacao.por_consulta_fonte_candidato
)}
${renderTabelaReconciliacao("Transições", reconciliacao.transicoes)}

<h3 class="subsection-title">Resíduos nas sete categorias</h3>
<div class="residuos-grid">${cardsResiduo}</div>

<section class="approval-box" id="aguardando-aprovacao-c7">
<h3>Aguardando aprovação</h3>
${
  aguardando
    ? `<p>${
        aguardando.total === undefined
          ? "A evidência registra itens dependentes de aprovação."
          : `${aguardando.total.toLocaleString("pt-BR")} item(ns) dependem de aprovação.`
      } ${aguardando.proxima_acao ? esc(aguardando.proxima_acao) : ""}</p>`
    : `<p class="nao-informado">Nenhum total foi informado para esta categoria. Isso não equivale a zero.</p>`
}
${aguardando?.itens?.length ? renderTabelaReconciliacao("Itens aguardando aprovação", aguardando.itens, true) : ""}
<p><a href="revisao/lote.html">Abrir a fila editorial completa</a></p>
</section>

<form class="aplicar-box" id="c7-aplicar" data-verificado-em="${esc(evidencia.verificado_em)}">
<fieldset><legend>Próxima ação</legend>${opcoes}</fieldset>
<label for="c7-instrucoes"><b>Instruções adicionais</b></label>
<textarea id="c7-instrucoes" name="instrucoes" placeholder="Restrições, ordem de prioridade ou contexto para a próxima execução."></textarea>
<button type="submit">Aplicar</button>
<p id="c7-aplicar-status" class="form-status" role="status" aria-live="polite"></p>
</form>
</section>`
}

function renderEvidencia(evidencia: EvidenciaRelatorio | undefined): string {
  if (!evidencia) return ""

  const estado = Object.entries(evidencia.dom.por_estado)
    .map(
      ([nome, valores]) =>
        `<tr><th scope="row">${esc(nome)}</th><td>${valores.legenda}</td><td>${valores.dom}</td><td>${valores.legenda === valores.dom ? "confere" : "diverge"}</td></tr>`
    )
    .join("")
  const fontes = evidencia.fontes
    .map(
      (fonte) =>
        `<tr><th scope="row"><code>${esc(fonte.slug)}</code><span class="party">${esc(
          fonte.nome_urna
        )}</span></th><td>${fonte.linhas_select}</td><td>${fonte.linhas_relatorio}</td><td>${fonte.divergencias}</td><td>${fonte.passou ? "confere" : "diverge"}</td></tr>`
    )
    .join("")
  const selo = (passou: boolean) =>
    `<b class="selo ${passou ? "passou" : "falhou"}">${passou ? "PASSOU" : "FALHOU"}</b>`

  return `<section class="evidencia" id="evidencias">
<h2>Evidências de verificação</h2>
<p class="notes">Coladas após abrir esta geração em navegador real, em ${esc(evidencia.verificado_em)}.</p>
<div class="evidence-grid">
  <article><h3>Régua antes x depois ${selo(evidencia.regua.passou)}</h3><p>${evidencia.regua.total_celulas_alteradas} célula(s) mudou(aram), em uma única consulta read-only: ${evidencia.regua.candidatos_antes} candidatos antes e ${evidencia.regua.candidatos_depois} depois.</p><p class="notes">Por coluna: ${esc(
    Object.entries(evidencia.regua.por_coluna)
      .map(([coluna, total]) => `${coluna}: ${total}`)
      .join(", ") || "nenhuma"
  )}.</p></article>
  <article><h3>Legenda x DOM ${selo(evidencia.dom.passou)}</h3><p>${evidencia.dom.total_legenda} células na legenda; ${evidencia.dom.total_dom} células contadas no DOM.</p>
    <div class="mini-wrap"><table><thead><tr><th>Estado</th><th>Legenda</th><th>DOM</th><th>Resultado</th></tr></thead><tbody>${estado}</tbody></table></div></article>
  <article><h3>Viewport móvel ${selo(evidencia.mobile.passou)}</h3><p>Viewport de ${evidencia.mobile.viewport_largura}px; documento ${evidencia.mobile.document_scroll_width}px / área útil ${evidencia.mobile.document_client_width}px. ${evidencia.mobile.tabelas_com_overflow} tabela(s) rolam dentro do próprio container.</p></article>
</div>
<article><h3>Fonte x <code>coleta_log_ultima</code> ${selo(evidencia.fontes.every((f) => f.passou))}</h3>
  <p class="notes">Comparação independente com <code>SELECT</code> direto, somente leitura. “Linhas do relatório” conta apenas fontes encontradas no <code>SELECT</code>; ausências são as linhas “nunca verificado”.</p>
  <div class="mini-wrap"><table><thead><tr><th>Candidato</th><th>SELECT</th><th>Relatório</th><th>Divergências</th><th>Resultado</th></tr></thead><tbody>${fontes}</tbody></table></div>
</article>
</section>`
}

const CSS = `
:root { color-scheme: light;
  --bg:#fafaf8; --fg:#1a1a1a; --muted:#6b6b6b; --line:#e4e2dc; --card:#ffffff;
  --ok-bg:#e3f2e6; --ok-fg:#1c6b2d; --partial-bg:#fdf3d7; --partial-fg:#8a6100;
  --miss-bg:#fbe4e4; --miss-fg:#a12622; --zero-bg:#f1f1ee; --zero-fg:#7a7a74;
  --na-bg:#f7f7f5; --na-fg:#b3b3ad; }
* { box-sizing:border-box; }
html, body { width:100%; max-width:100%; overflow-x:hidden; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:32px 24px 80px; }
main { width:100%; min-width:0; max-width:1500px; margin:0 auto; }
h1 { font-size:26px; margin:0 0 4px; letter-spacing:-0.01em; }
.sub { color:var(--muted); margin:0 0 20px; }
h2 { font-size:18px; margin:44px 0 10px; }
h2 .count { font-size:13px; color:var(--muted); font-weight:600; margin-left:6px; }
h3 { font-size:15px; margin:0; }
.legend { display:flex; flex-wrap:wrap; gap:8px 14px; margin:14px 0 6px; font-size:12.5px; }
.legend span { display:inline-flex; align-items:center; gap:6px; }
.legend b.tot { font-variant-numeric:tabular-nums; background:var(--card); border:1px solid var(--line); border-radius:999px; padding:1px 7px; font-size:11.5px; font-weight:600; }
.legend .soma { color:var(--muted); font-size:12px; }
.sw { width:14px; height:14px; border-radius:4px; display:inline-block; }
.sw.prov { width:16px; height:4px; border-radius:2px; }
.notes { font-size:12.5px; color:var(--muted); max-width:980px; margin:10px 0 4px; }
.notes li { margin-bottom:3px; }
.toc { display:flex; flex-wrap:wrap; gap:6px; margin:18px 0 8px; }
.chip { padding:4px 10px; border:1px solid var(--line); border-radius:999px; font-size:12.5px;
  font-weight:600; color:var(--fg); text-decoration:none; background:var(--card); }
.chip:hover { border-color:var(--muted); }
.twrap { width:100%; max-width:100%; overflow-x:auto; overscroll-behavior-inline:contain;
  border:1px solid var(--line); border-radius:10px; background:var(--card); }
table { border-collapse:collapse; width:max-content; min-width:100%; font-size:12.5px; }
thead th { position:sticky; top:0; background:var(--card); z-index:2;
  border-bottom:1px solid var(--line); padding:6px 6px 8px; vertical-align:bottom; }
th.cand { text-align:left; position:sticky; left:0; background:var(--card); z-index:3;
  min-width:190px; max-width:230px; padding:6px 12px; border-right:1px solid var(--line); }
tbody th.cand { font-weight:600; }
tbody th.cand a { color:var(--fg); text-decoration:none; }
tbody th.cand a:hover { text-decoration:underline; }
.party { display:block; font-size:11px; color:var(--muted); font-weight:500; }
.rot { writing-mode:vertical-rl; transform:rotate(180deg); white-space:nowrap;
  font-size:11px; font-weight:600; color:var(--muted); max-height:150px; }
td { text-align:center; padding:5px 7px; border-bottom:1px solid var(--line); min-width:44px; }
tbody tr:last-child td { border-bottom:none; }
td.c-ok { background:var(--ok-bg); color:var(--ok-fg); font-weight:600; }
td.c-partial { background:var(--partial-bg); color:var(--partial-fg); font-weight:600; }
td.c-missing { background:var(--miss-bg); color:var(--miss-fg); font-weight:700; }
td.c-zero { background:var(--zero-bg); color:var(--zero-fg); }
/* Procedência do zero: o traço diz de onde vem o silêncio. */
td[data-prov="zero_provado"] { box-shadow:inset 0 -3px 0 var(--prov-ok, #1c6b2d); color:var(--fg); }
td[data-prov="coletado"] { box-shadow:inset 0 -3px 0 var(--prov-coletado, #0f766e); color:var(--fg); }
td[data-prov="nunca_verificado"] { box-shadow:inset 0 -3px 0 var(--prov-nunca, #b98a00); }
td[data-prov="nao_sabemos"] { box-shadow:inset 0 -3px 0 var(--prov-erro, #a12622); }
td[data-prov="sem_ingest"] { box-shadow:inset 0 -3px 0 var(--prov-sem, #c9c7c0); }
td[data-prov="curadoria_concluida_sem_achado"] { box-shadow:inset 0 -3px 0 var(--prov-curadoria, #2563eb); color:var(--fg); }
td[data-prov="desconhecida"] { box-shadow:inset 0 -3px 0 var(--prov-desconhecida, #7d7a72); }
td.c-na { background:var(--na-bg); color:var(--na-fg); font-size:11px; }
td.scr { font-weight:700; border-right:1px solid var(--line); }
a.rev { color:var(--warn-link, #1f4fd8); font-weight:700; text-decoration:none; }
a.rev:hover { text-decoration:underline; }
.s-hi { color:var(--ok-fg); } .s-mid { color:var(--partial-fg); } .s-lo { color:var(--miss-fg); }
tfoot td, tfoot th { border-top:1px solid var(--line); font-size:11px; color:var(--muted); padding:6px; }
tfoot th.cand { text-align:left; }
.pend { background:#eef4fd; border:1px solid #cddffa; border-radius:8px; padding:10px 14px;
  font-size:12.5px; margin:16px 0 0; }
.fonte-intro { display:flex; align-items:baseline; gap:10px; margin:18px 0 7px; }
.fonte-intro p { color:var(--muted); font-size:12.5px; margin:0; }
table.fontes { min-width:850px; font-size:12px; }
table.fontes th, table.fontes td { text-align:left; white-space:nowrap; }
table.fontes th.fonte-cand { min-width:190px; max-width:220px; white-space:normal; vertical-align:top; }
table.fontes tbody th.fonte-cand { border-bottom:2px solid var(--line); padding-top:9px; }
table.fontes tbody tr:has(th.fonte-cand) td { border-top:2px solid var(--line); }
table.fontes td.fonte-nome { min-width:160px; }
table.fontes td.resultado { min-width:130px; font-weight:700; }
table.fontes td.volume { text-align:right; font-variant-numeric:tabular-nums; }
table.fontes td.data { min-width:145px; font-variant-numeric:tabular-nums; }
table.fontes td.detalhe { min-width:230px; max-width:420px; overflow:hidden; text-overflow:ellipsis; }
.faltam { display:inline-block; margin-top:7px; padding:2px 7px; border-radius:999px;
  background:#fdf3d7; color:#8a6100; font-size:10.5px; font-weight:700; }
.faltam.completo { background:#e3f2e6; color:#1c6b2d; }
.r-nunca_verificado { background:#fdf3d7; color:#8a6100; }
.r-erro, .r-indeterminado { background:#fbe4e4; color:#a12622; }
.r-vazio_confirmado { background:#f1f1ee; color:#4f4f4a; }
.r-sem_achado_no_escopo { background:#e8f0ff; color:#1d4ed8; }
.r-nao_aplicavel { background:#f7f7f5; color:#7a7a74; }
.r-encontrado { background:#e3f2e6; color:#1c6b2d; }
.fonte-indisponivel { color:var(--muted); font-style:italic; }
.evidencia { margin:22px 0 30px; padding:16px; border:1px solid var(--line); border-radius:10px; background:var(--card); }
.evidencia h2 { margin:0 0 6px; }
.evidencia article { min-width:0; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); }
.evidencia article + article { margin-top:10px; }
.evidencia article h3 { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.evidence-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:10px; margin:12px 0 10px; }
.mini-wrap { max-width:100%; overflow-x:auto; margin-top:8px; }
.mini-wrap table { width:100%; min-width:480px; }
.mini-wrap th, .mini-wrap td { text-align:left; padding:5px 8px; }
.selo { padding:2px 7px; border-radius:999px; font-size:10.5px; letter-spacing:.04em; }
.selo.passou { color:#1c6b2d; background:#e3f2e6; }
.selo.falhou { color:#a12622; background:#fbe4e4; }
.reconciliacao { margin:24px 0 34px; padding:clamp(14px,2vw,22px); border:1px solid #cddffa;
  border-radius:14px; background:linear-gradient(180deg,#f7faff 0,#fff 150px); min-width:0; }
.reconciliacao h2 { margin:2px 0 4px; }
.section-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.eyebrow { margin:0; color:#1d4ed8; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
.summary-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:14px 0 22px; }
.summary-grid article { min-width:0; border:1px solid var(--line); border-radius:10px; padding:12px; background:#fff; }
.summary-grid h3 { margin-bottom:6px; }
.summary-grid ul { margin:0; padding-left:18px; }
.summary-grid li { margin:3px 0; }
.nao-informado { color:var(--muted); font-style:italic; }
.subsection-title { margin:24px 0 8px; }
.recon-details { border:1px solid var(--line); border-radius:10px; background:#fff; margin:8px 0; overflow:hidden; }
.recon-details > summary { cursor:pointer; padding:10px 12px; font-weight:750; list-style-position:inside; }
.recon-details > summary:hover { background:#f7f7f5; }
.recon-details > summary .count { color:var(--muted); font-size:11px; margin-left:5px; }
.recon-table-wrap { max-width:100%; max-height:480px; overflow:auto; border-top:1px solid var(--line); }
.recon-table-wrap.totais { max-height:340px; border:1px solid var(--line); border-radius:10px; margin-top:14px; }
.recon-table-wrap table { width:max-content; min-width:100%; font-size:12px; }
.recon-table-wrap th, .recon-table-wrap td { text-align:left; min-width:110px; padding:7px 9px; vertical-align:top; }
.recon-table-wrap th:first-child { min-width:210px; max-width:360px; }
.recon-table-wrap code { white-space:normal; overflow-wrap:anywhere; }
.residuos-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.residuo { min-width:0; padding:12px; border:1px solid var(--line); border-radius:10px; background:#fff; }
.residuo h4 { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 0 7px; font-size:14px; }
.residuo p { margin:6px 0; }
.residuo-total { min-width:30px; text-align:center; padding:2px 7px; border-radius:999px; background:#f1f1ee; }
.approval-box { margin:20px 0; padding:14px; border-left:4px solid #8a6100; border-radius:8px; background:#fffaf0; }
.approval-box h3 { margin-bottom:6px; }
.aplicar-box { margin-top:20px; padding:16px; border:1px solid var(--line); border-radius:12px; background:#fff; }
.aplicar-box fieldset { border:0; padding:0; margin:0 0 14px; }
.aplicar-box legend { font-size:15px; font-weight:800; margin-bottom:8px; }
.acao-opcao { display:flex; align-items:flex-start; gap:9px; padding:10px 11px; margin:7px 0; border:1px solid var(--line);
  border-radius:10px; cursor:pointer; background:#fff; }
.acao-opcao:has(input:checked) { border-color:#1d4ed8; box-shadow:0 0 0 2px #dbe7ff; }
.acao-opcao input { margin-top:3px; }
.acao-opcao span, .acao-opcao small { display:block; }
.acao-opcao small { color:var(--muted); margin-top:2px; }
.aplicar-box textarea { display:block; width:100%; min-height:88px; margin-top:7px; padding:10px 11px; resize:vertical;
  border:1px solid var(--line); border-radius:9px; color:var(--fg); background:#fff; font:inherit; }
.aplicar-box button { margin-top:11px; padding:10px 20px; border:0; border-radius:9px; color:#fff; background:#1a1a1a;
  font:inherit; font-weight:750; cursor:pointer; }
.aplicar-box button[disabled] { opacity:.55; cursor:wait; }
.form-status { min-height:1.4em; margin:8px 0 0; font-weight:650; }
.pagination { display:flex; align-items:center; justify-content:flex-end; gap:8px; padding:8px 10px; border-top:1px solid var(--line); background:#fafaf8; }
.pagination button { border:1px solid var(--line); border-radius:7px; background:#fff; color:var(--fg); padding:4px 9px; cursor:pointer; }
.pagination button:disabled { opacity:.45; cursor:default; }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible {
  outline:3px solid #8ab4ff; outline-offset:2px; }
@media (max-width:600px) {
  body { padding:20px 12px 60px; }
  h1 { font-size:22px; }
  .fonte-intro { display:block; }
  .fonte-intro p { margin-top:3px; }
  .evidence-grid { grid-template-columns:1fr; }
  .section-head { display:block; }
  .section-head .selo { display:inline-block; margin-top:8px; }
  .summary-grid, .residuos-grid { grid-template-columns:1fr; }
  .reconciliacao { padding:13px 10px; }
  .recon-table-wrap th:first-child { min-width:170px; }
}
`

const JS_RELATORIO = `
(() => {
  const porPagina = 50;
  document.querySelectorAll('table.recon-table').forEach((table) => {
    const linhas = Array.from(table.tBodies[0]?.rows || []);
    if (linhas.length <= porPagina) return;
    let pagina = 0;
    const paginas = Math.ceil(linhas.length / porPagina);
    const barra = document.createElement('div');
    barra.className = 'pagination';
    const anterior = document.createElement('button');
    anterior.type = 'button'; anterior.textContent = 'Anterior';
    const status = document.createElement('span');
    const proxima = document.createElement('button');
    proxima.type = 'button'; proxima.textContent = 'Próxima';
    barra.append(anterior, status, proxima);
    table.closest('.recon-table-wrap')?.after(barra);
    const desenhar = () => {
      linhas.forEach((linha, indice) => { linha.hidden = Math.floor(indice / porPagina) !== pagina; });
      status.textContent = 'Página ' + (pagina + 1) + ' de ' + paginas;
      anterior.disabled = pagina === 0;
      proxima.disabled = pagina === paginas - 1;
    };
    anterior.addEventListener('click', () => { pagina -= 1; desenhar(); });
    proxima.addEventListener('click', () => { pagina += 1; desenhar(); });
    desenhar();
  });

  const form = document.getElementById('c7-aplicar');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selecionada = form.querySelector('input[name="acao-c7"]:checked');
    const botao = form.querySelector('button[type="submit"]');
    const status = document.getElementById('c7-aplicar-status');
    if (!selecionada || !botao || !status) return;
    const label = selecionada.closest('label')?.querySelector('b')?.textContent || selecionada.value;
    botao.disabled = true;
    status.textContent = 'Enviando…';
    try {
      const resposta = await fetch('/aplicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'c7_proxima_acao',
          opcoes: [{ id: selecionada.value, rotulo: label }],
          instrucoes: form.querySelector('[name="instrucoes"]')?.value || '',
          contexto: {
            verificado_em: form.dataset.verificadoEm || null,
            relatorio: window.location.pathname
          }
        })
      });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      status.textContent = 'Aplicado. A decisão foi registrada para a próxima execução.';
      status.style.color = '#1c6b2d';
    } catch (erro) {
      status.textContent = 'Não foi possível registrar: ' + erro;
      status.style.color = '#a12622';
    } finally {
      botao.disabled = false;
    }
  });
})();
`

export function renderHtml(
  coorte: CandidatoCoverage[],
  pendentes: PendingWrite[],
  evidencia?: EvidenciaRelatorio
): string {
  // Uma única materialização alimenta corpo e legenda. Recalcular os totais por
  // outro caminho foi a origem do falso alarme de regressão de 04/08.
  const matriz = new Map(coorte.map((c) => [c.slug, calcularCelulas(c)]))
  const presidentes = coorte.filter((c) => c.cargo_disputado === "Presidente")
  const governadores = coorte.filter((c) => c.cargo_disputado === "Governador")
  const ufs = [...new Set(governadores.map((c) => c.estado).filter(Boolean) as string[])].sort()
  // Nenhum perfil público pode escapar do guia: quem não é Presidente nem
  // Governador (hoje, vice-governadores) entra numa seção própria.
  const outros = coorte.filter(
    (c) => c.cargo_disputado !== "Presidente" && c.cargo_disputado !== "Governador"
  )

  const toc =
    (evidencia ? `<a href="#evidencias" class="chip">Evidências</a>` : "") +
    (evidencia?.reconciliacao
      ? `<a href="#reconciliacao" class="chip">Reconciliação C7</a>`
      : "") +
    `<a href="#presidentes" class="chip">Presidente</a>` +
    ufs.map((uf) => `<a href="#uf-${uf.toLowerCase()}" class="chip">${uf}</a>`).join("") +
    (outros.length ? `<a href="#outros" class="chip">Outros cargos</a>` : "")

  const secoes = [
    `<h2 id="presidentes">Pré-candidatos a Presidente <span class="count">${presidentes.length}</span></h2>` +
      renderTabela(presidentes, "t-pres", matriz) +
      renderTabelaFontes(presidentes, "f-pres"),
    ...ufs.map((uf) => {
      const cs = governadores.filter((c) => c.estado === uf)
      return (
        `<h2 id="uf-${uf.toLowerCase()}">${uf} · ${UF_NOME[uf] ?? uf} — Governador <span class="count">${cs.length}</span></h2>` +
        renderTabela(cs, `t-${uf.toLowerCase()}`, matriz) +
        renderTabelaFontes(cs, `f-${uf.toLowerCase()}`)
      )
    }),
    ...(outros.length
      ? [
          `<h2 id="outros">Outros cargos <span class="count">${outros.length}</span></h2>` +
            renderTabela(outros, "t-outros", matriz) +
            renderTabelaFontes(outros, "f-outros")
        ]
      : [])
  ]

  const blocoPendentes = pendentes.length
    ? `<div class="pend"><b>Migrations pendentes sobrepostas:</b> ${pendentes.length} write(s) anotado(s) com <code>-- @write</code> em <code>supabase/migrations/</code> ainda não aplicado(s) em produção. O relatório mostra a cobertura <b>depois</b> da aplicação. Nada foi escrito no banco por este script.</div>`
    : ""

  const data = new Date().toLocaleDateString("pt-BR")

  // Totais da legenda. Sem eles, quem abre o relatório vê as cores e não sabe o
  // tamanho de cada balde, que é a primeira pergunta que todo mundo faz.
  const totalEstado = new Map<string, number>()
  const totalProveniencia = new Map<string, number>()
  for (const cand of coorte) {
    for (const cel of Object.values(matriz.get(cand.slug)!)) {
      totalEstado.set(cel.state, (totalEstado.get(cel.state) ?? 0) + 1)
      if (cel.proveniencia) {
        totalProveniencia.set(cel.proveniencia, (totalProveniencia.get(cel.proveniencia) ?? 0) + 1)
      }
    }
  }
  const nm = (n: number) => n.toLocaleString("pt-BR")
  const pill = (n: number) => `<b class="tot">${nm(n)}</b>`
  const totalCelulas = [...totalEstado.values()].reduce((a, b) => a + b, 0)
  const totalAguardandoAprovacao = [...matriz.values()].reduce(
    (total, celulas) => total + Number(celulas.revisar?.text ?? 0),
    0
  )

  // A legenda de procedência só aparece quando há procedência para explicar.
  const temProveniencia = coorte.some((c) => c.coletas !== undefined)
  const legendaProveniencia = temProveniencia
    ? (
        [
          ["coletado", "#0f766e"],
          ["zero_provado", "#1c6b2d"],
          ["nunca_verificado", "#b98a00"],
          ["nao_sabemos", "#a12622"],
          ["sem_ingest", "#c9c7c0"],
          ["curadoria_concluida_sem_achado", "#2563eb"],
          ["desconhecida", "#7d7a72"]
        ] as const
      )
        .map(
          ([p, cor]) =>
            `<span><span class="sw prov" style="background:${cor}"></span>Zero: ${esc(
              ROTULO_PROVENIENCIA[p]
            )} ${pill(totalProveniencia.get(p) ?? 0)}</span>`
        )
        .join("")
    : `<span class="notes" style="margin:0">Procedência do zero indisponível: este relatório não leu <code>coleta_log</code>, então nenhum zero distingue "verificado e vazio" de "nunca coletado".</span>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Puxa Ficha · Cobertura de dados por candidato</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>Puxa Ficha · Cobertura de dados por candidato</h1>
<p class="sub">O que o leitor vê em <a href="https://puxaficha.com.br" target="_blank" rel="noopener">puxaficha.com.br</a>, medido em ${data}.
${presidentes.length} pré-candidatos a Presidente, ${governadores.length} a Governador em ${ufs.length} UFs${outros.length ? ` e ${outros.length} em outros cargos` : ""}.
Gerado por <code>scripts/audit/coverage-report.ts</code>.</p>

<div class="legend">
  <span><span class="sw" style="background:var(--ok-bg)"></span>Preenchido (número = volume) ${pill(totalEstado.get("ok") ?? 0)}</span>
  <span><span class="sw" style="background:var(--partial-bg)"></span>Parcial ${pill(totalEstado.get("partial") ?? 0)}</span>
  <span><span class="sw" style="background:var(--miss-bg)"></span>Esperado e vazio ${pill(totalEstado.get("missing") ?? 0)}</span>
  <span><span class="sw" style="background:var(--zero-bg)"></span>Zero ${pill(totalEstado.get("zero") ?? 0)}</span>
  <span><span class="sw" style="background:var(--na-bg)"></span>Não se aplica ${pill(totalEstado.get("na") ?? 0)}</span>
  <span class="soma">${nm(totalCelulas)} células no total, ${nm(coorte.length)} candidatos x ${nm(COLUNAS.length)} frentes de dado</span>
</div>
<div class="legend">${legendaProveniencia}</div>
<div class="legend"><span><span class="sw" style="background:#fdf3d7"></span>Aguardando aprovação ${pill(totalAguardandoAprovacao)}</span><span class="notes" style="margin:0">Fila editorial separada da cobertura concluída.</span></div>
<p class="notes"><b>Novo eixo por fonte:</b> ${FONTES_POR_CANDIDATO.length} fontes canônicas de escopo candidato, com uma linha por fonte e candidato, mais fontes adicionais que já tenham tentativa registrada. “Nunca verificado” é reservado a fonte aplicável sem tentativa; Câmara e Jarbas, ou Senado e CEAPS, saem como “N/A” quando não há ID oficial nem mandato correspondente no histórico. Uma tentativa registrada sempre mostra seu desfecho real. Fontes territoriais não entram, porque seu alvo é a UF ou um agregado, não a pessoa.</p>
<ul class="notes">
  <li><b>Não se aplica</b> é inferido do histórico político registrado no próprio site: cota parlamentar exige mandato de deputado federal ou senador com fim a partir de 2009 (quando começa a cota digital do CEAP); votações-chave, mandato federal com fim a partir de 2012 (janela das votações carregadas no banco); projetos de lei, mandato parlamentar em qualquer esfera; legislação do Executivo, chefia de Executivo; patrimônio e financiamento, já ter declarado ao TSE, isto é, SQ_CANDIDATO conhecido no seed do projeto ou candidatura / mandato eletivo no histórico com início até 2024. A pré-candidatura de 2026 não conta, e cargo por nomeação (ministro, secretário, presidência de partido) também não. Histórico incompleto pode gerar falso "não se aplica".</li>
  <li><b>Zero</b> (cargos ocupados, trocas de partido, contradições, processos, alertas, sanções): o traço embaixo da célula diz por que ela está zerada, lido da última tentativa em <code>coleta_log</code>. Verde, todas as fontes responderam vazio. Azul, a curadoria terminou sem achado no escopo declarado, sem prometer ausência absoluta. Âmbar, falta tentativa. Vermelho, a tentativa foi inconclusiva. Cinza, não existe ingest automático. Sem traço, o log não foi lido.</li>
  <li><b>Preenchimento</b>: entram no índice exatamente 15 colunas: foto, bio, redes sociais, dados pessoais (cheio com 3 de 4 ou mais), patrimônio, evolução patrimonial, bens ano a ano, financiamento, doadores detalhados, votações-chave, projetos de lei, cota parlamentar, legislação do Executivo, notícias e posições (quiz). Só contam as aplicáveis ao candidato; parcial vale meio ponto. Ficam fora as seis colunas de zero acima e "proj. em destaque" (curadoria editorial), por isso pode haver 100% com célula amarela de destaque.</li>
  <li>Alertas contam pontos de atenção visíveis que não sejam "feito positivo". Dados pessoais = idade (da view pública <code>candidatos_publico</code>, derivada da data de nascimento), naturalidade, formação e profissão. Posições (quiz) é x/3, um por tema do quiz presidencial.</li>
</ul>
${blocoPendentes}
${renderEvidencia(evidencia)}
${evidencia ? renderReconciliacao(evidencia) : ""}
<p class="notes" style="font-size:13.5px"><b>Aguardando aprovação:</b> <a href="revisao/lote.html">abrir a fila editorial numa tabela separada</a>, uma linha por fato, com filtro por tipo e cargo e um envio no fim.</p>
<nav class="toc">${toc}</nav>
${secoes.join("")}
</main>
<script>${JS_RELATORIO}</script>
</body>
</html>`
}

// ── Páginas de revisão ──────────────────────────────────────────────

const CSS_REVISAO = `
:root{color-scheme:light;--bg:#fafaf8;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e4e2dc;--card:#fff;
--ok:#1c6b2d;--okbg:#e3f2e6;--bad:#a12622;--badbg:#fbe4e4;--warnbg:#fdf3d7;--warn:#8a6100;--accent:#1f4fd8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:34px 22px 90px}
main{max-width:900px;margin:0 auto}
a.voltar{color:var(--muted);text-decoration:none;font-size:13px}
a.voltar:hover{text-decoration:underline}
h1{font-size:25px;margin:10px 0 4px}
.sub{color:var(--muted);margin:0 0 22px;font-size:14px}
.item{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:16px 18px;margin:14px 0}
.classe{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--warn);background:var(--warnbg);display:inline-block;padding:2px 9px;border-radius:999px}
.item h2{font-size:16.5px;margin:10px 0 6px}
.item p{margin:6px 0;font-size:14px}
.meta{font-size:12.5px;color:var(--muted)}
.efeito{font-size:13px;color:var(--fg);background:#f4f3ef;border-radius:8px;padding:8px 11px;margin-top:10px}
.escolha{display:flex;gap:9px;margin-top:12px;flex-wrap:wrap}
.escolha label{border:1px solid var(--line);border-radius:9px;padding:7px 14px;cursor:pointer;font-size:14px;font-weight:600;background:#fff}
.escolha label:hover{border-color:var(--accent)}
.escolha input{margin-right:7px}
.escolha label.ap{color:var(--ok)} .escolha label.rj{color:var(--bad)}
textarea{width:100%;min-height:80px;border:1px solid var(--line);border-radius:10px;padding:11px;font:inherit;font-size:14px;margin-top:8px}
button{background:#1a1a1a;color:#fff;border:0;border-radius:10px;padding:12px 26px;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px}
button:hover{background:#000}
#msg{margin-top:12px;font-weight:600}
.vazio{background:var(--okbg);color:var(--ok);border-radius:10px;padding:16px 18px;font-weight:600}
`

function renderItem(item: ItemRevisar, i: number): string {
  const fonte = item.fonte ? `<p class="meta">Fonte: ${esc(item.fonte)}</p>` : ""
  const url = item.url
    ? `<p class="meta">Link: <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.url)}</a></p>`
    : `<p class="meta">Sem URL de fonte registrada.</p>`
  const detalhe = item.detalhe ? `<p>${esc(item.detalhe)}</p>` : ""
  return `<div class="item" data-id="${esc(item.id)}" data-classe="${esc(item.classe)}">
  <span class="classe">${esc(ROTULO_CLASSE[item.classe] ?? item.classe)}</span>
  <h2>${esc(item.titulo)}</h2>
  ${detalhe}${fonte}${url}
  <div class="efeito">${esc(item.efeito)}</div>
  <div class="escolha">
    <label class="ap"><input type="radio" name="d${i}" value="aprovar">Aprovar</label>
    <label class="rj"><input type="radio" name="d${i}" value="rejeitar">Rejeitar</label>
    <label><input type="radio" name="d${i}" value="adiar" checked>Decidir depois</label>
  </div>
</div>`
}

export function renderPaginaRevisao(cand: CandidatoCoverage, postUrl: string): string {
  const itens = cand.itensRevisar
  const corpo = itens.length
    ? itens.map(renderItem).join("")
    : `<div class="vazio">Nada esperando revisão para este candidato.</div>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Revisar · ${esc(cand.nome_urna)}</title>
<style>${CSS_REVISAO}</style>
</head>
<body>
<main>
<a class="voltar" href="../${esc(NOME_INDEX)}">Voltar para a tabela de cobertura</a>
<h1>Revisar · ${esc(cand.nome_urna)}</h1>
<p class="sub">${itens.length} item(ns) esperando decisão. Nada aqui muda o site sozinho:
o envio grava suas decisões e a aplicação é um passo separado.
<a href="https://puxaficha.com.br/candidato/${esc(cand.slug)}" target="_blank" rel="noopener">Ver a ficha pública</a>.</p>
<form id="f">
${corpo}
<h3>Observação livre</h3>
<textarea name="livre" placeholder="Contexto, correção de texto, o que investigar antes de aplicar."></textarea>
<button type="submit">Enviar decisões</button>
<div id="msg"></div>
</form>
</main>
<script>
const SLUG = ${JSON.stringify(cand.slug)};
const ITENS = ${JSON.stringify(itens.map((i) => ({ id: i.id, classe: i.classe, titulo: i.titulo })))};
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const decisoes = ITENS.map((it, i) => {
    const sel = document.querySelector('input[name="d' + i + '"]:checked');
    return { id: it.id, classe: it.classe, titulo: it.titulo, decisao: sel ? sel.value : 'adiar' };
  });
  const msg = document.getElementById('msg');
  try {
    const r = await fetch(${JSON.stringify(postUrl)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, decisoes, livre: document.querySelector('textarea[name=livre]').value })
    });
    msg.textContent = r.ok ? 'Decisões enviadas. Pode fechar ou voltar para a tabela.' : 'Falhou ao enviar (HTTP ' + r.status + ').';
    msg.style.color = r.ok ? '#1c6b2d' : '#a12622';
  } catch (err) {
    msg.textContent = 'Falhou ao enviar: ' + err;
    msg.style.color = '#a12622';
  }
});
</script>
</body>
</html>`
}

let NOME_INDEX = "index.html"

// ── Revisão em lote ─────────────────────────────────────────────────
//
// Uma linha por FATO, não por candidato: quem tem 5 itens ocupa 5 linhas
// seguidas. É a superfície para varrer a fila inteira de uma vez, com um envio
// só no fim. As páginas por candidato continuam existindo para o caso oposto,
// quando se quer olhar um perfil a fundo.

const CSS_LOTE = `
:root{color-scheme:light;--bg:#fafaf8;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e4e2dc;--card:#fff;
--ok:#1c6b2d;--okbg:#e3f2e6;--bad:#a12622;--badbg:#fbe4e4;--warn:#8a6100;--warnbg:#fdf3d7;--accent:#1f4fd8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:26px 20px 140px}
main{max-width:1500px;margin:0 auto}
h1{font-size:24px;margin:8px 0 4px}
.sub{color:var(--muted);margin:0 0 16px;font-size:13.5px}
a.voltar{color:var(--muted);text-decoration:none;font-size:13px}
a.voltar:hover{text-decoration:underline}
.barra{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:11px 14px;margin-bottom:14px;font-size:13px}
.barra select,.barra input[type=search]{border:1px solid var(--line);border-radius:8px;padding:6px 9px;font:inherit;font-size:13px;background:#fff}
.barra button{background:#fff;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer}
.barra button:hover{border-color:var(--accent)}
.contador{margin-left:auto;font-weight:700}
.twrap{border:1px solid var(--line);border-radius:11px;background:var(--card);overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
thead th{position:sticky;top:0;background:#f4f3ef;z-index:2;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
tr.primeira-do-candidato td{border-top:2px solid #dcdad3}
tr.decidida{background:#fbfbf9}
.cand{font-weight:700;white-space:nowrap}
.cand a{color:var(--fg);text-decoration:none}
.cand a:hover{text-decoration:underline}
.meta{color:var(--muted);font-size:12px;white-space:nowrap}
.classe{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:2px 7px;border-radius:999px;background:var(--warnbg);color:var(--warn);white-space:nowrap}
.classe.no-ar{background:var(--badbg);color:var(--bad)}
.fato{max-width:620px}
.fato b{display:block;margin-bottom:3px}
.fonte{max-width:230px;word-break:break-all;font-size:12px}
.fonte a{color:var(--accent)}
.dec{white-space:nowrap}
.dec label{display:inline-block;margin-right:7px;cursor:pointer;font-weight:600;font-size:12.5px}
.dec label.ap{color:var(--ok)} .dec label.rj{color:var(--bad)} .dec label.ad{color:var(--muted)}
.rodape{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.97);border-top:1px solid var(--line);padding:12px 20px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.rodape button{background:#1a1a1a;color:#fff;border:0;border-radius:10px;padding:11px 26px;font-size:15px;font-weight:600;cursor:pointer}
.rodape button:hover{background:#000}
.rodape input[type=text]{border:1px solid var(--line);border-radius:9px;padding:9px 11px;font:inherit;font-size:14px;min-width:330px}
#msg{font-weight:600}
`

interface LinhaLote {
  cand: CandidatoCoverage
  item: ItemRevisar
  primeira: boolean
}

function linhasDoLote(coorte: CandidatoCoverage[]): LinhaLote[] {
  const ordemCargo = (c: string | null): number =>
    c === "Presidente" ? 0 : c === "Governador" ? 1 : 2

  const comFila = coorte
    .filter((c) => c.itensRevisar.length > 0)
    .sort(
      (a, b) =>
        ordemCargo(a.cargo_disputado) - ordemCargo(b.cargo_disputado) ||
        (a.estado ?? "").localeCompare(b.estado ?? "", "pt-BR") ||
        a.nome_urna.localeCompare(b.nome_urna, "pt-BR")
    )

  const linhas: LinhaLote[] = []
  for (const cand of comFila) {
    cand.itensRevisar.forEach((item, i) => {
      linhas.push({ cand, item, primeira: i === 0 })
    })
  }
  return linhas
}

export function renderPaginaLote(coorte: CandidatoCoverage[], postUrl: string): string {
  const linhas = linhasDoLote(coorte)
  const classes = [...new Set(linhas.map((l) => l.item.classe))]

  const trs = linhas
    .map(({ cand, item, primeira }, i) => {
      const fonte = item.url
        ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">abrir fonte</a>`
        : `<span class="meta">sem link</span>`
      const origem = item.fonte ? `<div class="meta">${esc(item.fonte)}</div>` : ""
      const noAr = item.classe === "ponto_atencao_ia_no_ar_sem_revisao"
      return `<tr class="${primeira ? "primeira-do-candidato" : ""}" data-i="${i}"
  data-slug="${esc(cand.slug)}" data-classe="${esc(item.classe)}"
  data-cargo="${esc(cand.cargo_disputado ?? "")}"
  data-busca="${esc((cand.nome_urna + " " + (cand.partido_sigla ?? "") + " " + item.titulo + " " + (item.detalhe ?? "")).toLowerCase())}">
  <td class="cand"><a href="https://puxaficha.com.br/candidato/${esc(cand.slug)}" target="_blank" rel="noopener">${esc(cand.nome_urna)}</a></td>
  <td class="meta">${esc(cand.partido_sigla ?? "—")}</td>
  <td class="meta">${esc(cand.estado ?? "BR")}</td>
  <td class="meta">${esc(cand.cargo_disputado ?? "—")}</td>
  <td><span class="classe${noAr ? " no-ar" : ""}">${esc(ROTULO_CLASSE[item.classe] ?? item.classe)}</span></td>
  <td class="fato"><b>${esc(item.titulo)}</b>${item.detalhe ? esc(item.detalhe) : '<span class="meta">sem texto registrado</span>'}</td>
  <td class="fonte">${fonte}${origem}</td>
  <td class="dec">
    <label class="ap"><input type="radio" name="d${i}" value="aprovar">Aprovar</label>
    <label class="rj"><input type="radio" name="d${i}" value="rejeitar">Rejeitar</label>
    <label class="ad"><input type="radio" name="d${i}" value="adiar" checked>Depois</label>
  </td>
</tr>`
    })
    .join("")

  const opcoesClasse = classes
    .map((c) => `<option value="${esc(c)}">${esc(ROTULO_CLASSE[c] ?? c)}</option>`)
    .join("")

  const dados = linhas.map(({ cand, item }) => ({
    slug: cand.slug,
    id: item.id,
    classe: item.classe,
    titulo: item.titulo
  }))

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Revisão em lote · Puxa Ficha</title>
<style>${CSS_LOTE}</style>
</head>
<body>
<main>
<a class="voltar" href="../${esc(NOME_INDEX)}">Voltar para a tabela de cobertura</a>
<h1>Revisão em lote</h1>
<p class="sub">Uma linha por fato. Quem tem mais de um item aparece em linhas seguidas.
Nada aqui muda o site: o envio grava suas decisões e a aplicação é um passo separado, com migration e readback.</p>

<div class="barra">
  <label>Classe
    <select id="fClasse"><option value="">todas</option>${opcoesClasse}</select>
  </label>
  <label>Cargo
    <select id="fCargo"><option value="">todos</option><option>Presidente</option><option>Governador</option><option>Vice-Governador</option></select>
  </label>
  <input type="search" id="fBusca" placeholder="filtrar por nome, partido ou texto">
  <button type="button" id="bAprovar">Aprovar visíveis</button>
  <button type="button" id="bRejeitar">Rejeitar visíveis</button>
  <button type="button" id="bLimpar">Limpar visíveis</button>
  <span class="contador" id="contador"></span>
</div>

<div class="twrap"><table>
<thead><tr>
  <th>Candidato</th><th>Partido</th><th>UF</th><th>Cargo</th>
  <th>Tipo</th><th>Fato a checar</th><th>Referência</th><th>Decisão</th>
</tr></thead>
<tbody id="corpo">${trs}</tbody>
</table></div>
</main>

<div class="rodape">
  <input type="text" id="livre" placeholder="Observação livre para este envio (opcional)">
  <button type="button" id="enviar">Enviar decisões</button>
  <span id="msg"></span>
</div>

<script>
const DADOS = ${JSON.stringify(dados)};
const corpo = document.getElementById('corpo');
const linhas = Array.from(corpo.querySelectorAll('tr'));

function visiveis() { return linhas.filter(tr => tr.style.display !== 'none'); }
function decisaoDe(tr) {
  const sel = tr.querySelector('input[type=radio]:checked');
  return sel ? sel.value : 'adiar';
}
function atualizar() {
  let decididas = 0;
  for (const tr of linhas) {
    const d = decisaoDe(tr);
    tr.classList.toggle('decidida', d !== 'adiar');
    if (d !== 'adiar') decididas++;
  }
  document.getElementById('contador').textContent =
    decididas + ' de ' + linhas.length + ' decidido(s) · ' + visiveis().length + ' visível(is)';
}
function filtrar() {
  const cl = document.getElementById('fClasse').value;
  const cg = document.getElementById('fCargo').value;
  const q = document.getElementById('fBusca').value.trim().toLowerCase();
  for (const tr of linhas) {
    const ok = (!cl || tr.dataset.classe === cl)
      && (!cg || tr.dataset.cargo === cg)
      && (!q || tr.dataset.busca.includes(q));
    tr.style.display = ok ? '' : 'none';
  }
  atualizar();
}
function marcarVisiveis(valor) {
  for (const tr of visiveis()) {
    const r = tr.querySelector('input[type=radio][value="' + valor + '"]');
    if (r) r.checked = true;
  }
  atualizar();
}

document.getElementById('fClasse').addEventListener('change', filtrar);
document.getElementById('fCargo').addEventListener('change', filtrar);
document.getElementById('fBusca').addEventListener('input', filtrar);
document.getElementById('bAprovar').addEventListener('click', () => marcarVisiveis('aprovar'));
document.getElementById('bRejeitar').addEventListener('click', () => marcarVisiveis('rejeitar'));
document.getElementById('bLimpar').addEventListener('click', () => marcarVisiveis('adiar'));
corpo.addEventListener('change', atualizar);

document.getElementById('enviar').addEventListener('click', async () => {
  const msg = document.getElementById('msg');
  const porSlug = new Map();
  linhas.forEach((tr, i) => {
    const d = decisaoDe(tr);
    if (d === 'adiar') return;
    const meta = DADOS[i];
    if (!porSlug.has(meta.slug)) porSlug.set(meta.slug, []);
    porSlug.get(meta.slug).push({ id: meta.id, classe: meta.classe, titulo: meta.titulo, decisao: d });
  });
  if (porSlug.size === 0) { msg.textContent = 'Nenhuma decisão marcada.'; msg.style.color = '#8a6100'; return; }

  const livre = document.getElementById('livre').value;
  let enviados = 0, falhas = 0;
  for (const [slug, decisoes] of porSlug) {
    try {
      const r = await fetch(${JSON.stringify(postUrl)}, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, decisoes, livre, origem: 'lote' })
      });
      if (r.ok) enviados += decisoes.length; else falhas += decisoes.length;
    } catch (e) { falhas += decisoes.length; }
  }
  msg.textContent = falhas === 0
    ? enviados + ' decisão(ões) enviada(s) em ' + porSlug.size + ' candidato(s).'
    : enviados + ' enviada(s), ' + falhas + ' falharam.';
  msg.style.color = falhas === 0 ? '#1c6b2d' : '#a12622';
});

filtrar();
</script>
</body>
</html>`
}

// ── main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opcoes = parseArgs(process.argv.slice(2))
  NOME_INDEX = basename(opcoes.out)

  // Sem snapshot em disco, roda o .sql no banco (somente leitura) e grava. O
  // arquivo fica para inspeção e para reexecutar o desenho sem tocar a rede.
  let caminhoSnapshot = opcoes.fromSnapshot
  if (!caminhoSnapshot) {
    const sql = join(RAIZ, "scripts", "audit", "coverage-snapshot.sql")
    const linhas = await obterSnapshot(sql)
    mkdirSync(dirname(opcoes.snapshotOut), { recursive: true })
    writeFileSync(opcoes.snapshotOut, JSON.stringify(linhas, null, 2), "utf8")
    console.error(
      `[cobertura] snapshot: ${linhas.length} candidato(s) publicável(is) → ${opcoes.snapshotOut}`
    )
    caminhoSnapshot = opcoes.snapshotOut

    // A procedência do zero vem no próprio snapshot, no campo `coleta` de cada
    // candidato. Uma consulta em vez de duas, e o arquivo do snapshot continua
    // sendo a entrada única e inspecionável do relatório.
    const comLog = linhas.filter(
      (c) => Object.keys((c as { coleta?: object }).coleta ?? {}).length > 0
    ).length
    console.error(
      comLog > 0
        ? `[cobertura] log de coleta: tentativas registradas para ${comLog} candidato(s)`
        : "[cobertura] log de coleta: nenhuma tentativa registrada; todo zero sai sem prova"
    )
  }

  const pendentes = opcoes.comPendentes
    ? lerPendingWrites(join(RAIZ, "supabase", "migrations"), opcoes.migrationsDesde)
    : []

  let coorte = lerSnapshot(caminhoSnapshot, opcoes.slugs)
  if (pendentes.length) {
    const r = aplicarPendentes(coorte, pendentes)
    coorte = r.coorte
    console.error(`[cobertura] ${r.aplicados} write(s) pendente(s) sobreposto(s)`)
  }

  const evidencia = opcoes.evidence
    ? (JSON.parse(readFileSync(opcoes.evidence, "utf8")) as EvidenciaRelatorio)
    : undefined
  const html = renderHtml(coorte, pendentes, evidencia)
  mkdirSync(dirname(opcoes.out), { recursive: true })
  writeFileSync(opcoes.out, html, "utf8")
  console.error(`[cobertura] HTML: ${opcoes.out} (${html.length} bytes)`)
  if (opcoes.evidence) console.error(`[cobertura] evidências: ${opcoes.evidence}`)

  // Uma página de revisão por candidato com fila pendente, ao lado do relatório.
  const dirRevisao = join(dirname(opcoes.out), "revisao")
  mkdirSync(dirRevisao, { recursive: true })
  let paginas = 0
  let itens = 0
  for (const cand of coorte) {
    if (cand.itensRevisar.length === 0) continue
    writeFileSync(
      join(dirRevisao, `${cand.slug}.html`),
      renderPaginaRevisao(cand, opcoes.reviewPost),
      "utf8"
    )
    paginas += 1
    itens += cand.itensRevisar.length
  }
  writeFileSync(join(dirRevisao, "lote.html"), renderPaginaLote(coorte, opcoes.reviewPost), "utf8")
  console.error(
    `[cobertura] revisão: ${paginas} página(s) + lote.html, ${itens} item(ns) em ${dirRevisao}`
  )

  if (opcoes.json) {
    const dump = coorte.map((c) => ({
      slug: c.slug,
      nome_urna: c.nome_urna,
      cargo_disputado: c.cargo_disputado,
      estado: c.estado,
      celulas: Object.fromEntries(Object.entries(calcularCelulas(c)).map(([k, v]) => [k, v.state])),
      indice: calcularIndice(calcularCelulas(c))
    }))
    mkdirSync(dirname(opcoes.json), { recursive: true })
    writeFileSync(opcoes.json, JSON.stringify(dump, null, 2), "utf8")
    console.error(`[cobertura] JSON: ${opcoes.json}`)
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
