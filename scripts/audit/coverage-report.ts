/**
 * Relatório de cobertura de dados por candidato (2026-08-02).
 *
 * Lê o banco em modo **somente leitura** e gera um HTML com uma tabela dos
 * pré-candidatos a Presidente e uma tabela por UF de Governador. A régua (cinco
 * estados de célula, aplicabilidade e índice de 15 colunas) vive em
 * `lib/coverage-model.ts`; este arquivo só busca, monta e desenha.
 *
 * Não escreve em banco. O único efeito colateral é o arquivo HTML de saída
 * (e o JSON irmão, quando pedido).
 *
 * Uso:
 *   tsx scripts/audit/coverage-report.ts
 *   tsx scripts/audit/coverage-report.ts --com-migrations-pendentes
 *   tsx scripts/audit/coverage-report.ts --out=/caminho/relatorio.html --json
 *
 * Flags:
 *   --out=PATH                  caminho do HTML (default: ~/.disposable-html/AAAA-MM-DD-puxa-ficha-cobertura-dados.descartavel.html)
 *   --from-snapshot=PATH        lê o snapshot JSON produzido por `coverage-snapshot.sql`
 *                               em vez de consultar o banco (útil quando a máquina
 *                               não tem SUPABASE_SERVICE_ROLE_KEY). Mesmo resultado.
 *   --json[=PATH]               grava também o JSON de estados por célula
 *   --com-migrations-pendentes  sobrepõe o efeito das migrations anotadas com
 *                               `-- @write` que ainda não foram aplicadas
 *   --migrations-desde=PREFIXO  restringe a varredura de migrations pendentes
 *   --slugs=a,b,c               limita o relatório a esses slugs
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"

import { supabase } from "../lib/supabase"
import type { CandidatoConfig } from "../lib/types"
import { readFileSync } from "node:fs"
import {
  COLUNAS,
  calcularCelulas,
  calcularIndice,
  type CandidatoCoverage,
  type Cell,
  type HistoricoEvento,
} from "./lib/coverage-model"
import { lerPendingWrites, type PendingWrite } from "./lib/pending-writes"

const RAIZ = resolve(import.meta.dirname, "..", "..")

const UF_NOME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
  PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RO: "Rondônia", RR: "Roraima",
  RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo",
  TO: "Tocantins",
}

// ── CLI ────────────────────────────────────────────────────────────

interface Opcoes {
  out: string
  json: string | null
  comPendentes: boolean
  migrationsDesde?: string
  slugs?: Set<string>
  fromSnapshot?: string
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
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
    slugs: slugs ? new Set(slugs.split(",").map((s) => s.trim()).filter(Boolean)) : undefined,
    fromSnapshot: get("from-snapshot") || undefined,
  }
}

// ── Leitura do banco (paginada, somente SELECT) ─────────────────────

async function selectAll<T>(tabela: string, colunas: string): Promise<T[]> {
  const pagina = 1000
  const linhas: T[] = []
  for (let from = 0; ; from += pagina) {
    const { data, error } = await supabase
      .from(tabela)
      .select(colunas)
      .range(from, from + pagina - 1)
    if (error) throw new Error(`falha lendo ${tabela}: ${error.message}`)
    const lote = (data ?? []) as T[]
    linhas.push(...lote)
    if (lote.length < pagina) break
  }
  return linhas
}

function contarPorCandidato<T extends { candidato_id: string | null }>(
  linhas: T[],
  aceita: (linha: T) => boolean = () => true
): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const linha of linhas) {
    if (!linha.candidato_id || !aceita(linha)) continue
    mapa.set(linha.candidato_id, (mapa.get(linha.candidato_id) ?? 0) + 1)
  }
  return mapa
}

function agruparPorCandidato<T extends { candidato_id: string | null }>(
  linhas: T[]
): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const linha of linhas) {
    if (!linha.candidato_id) continue
    const atual = mapa.get(linha.candidato_id)
    if (atual) atual.push(linha)
    else mapa.set(linha.candidato_id, [linha])
  }
  return mapa
}

interface CandidatoPublico {
  id: string
  slug: string
  nome_urna: string | null
  partido_sigla: string | null
  cargo_disputado: string | null
  estado: string | null
  foto_url: string | null
  biografia: string | null
  redes_sociais: unknown
  idade: number | null
  naturalidade: string | null
  formacao: string | null
  profissao_declarada: string | null
}

function temRedes(raw: unknown): boolean {
  if (!raw) return false
  if (Array.isArray(raw)) return raw.length > 0
  if (typeof raw === "object") return Object.keys(raw as object).length > 0
  return false
}

/** Slugs com SQ_CANDIDATO conhecido no seed `data/candidatos.json`. */
function slugsComSqNoSeed(): Set<string> {
  const seed: CandidatoConfig[] = JSON.parse(
    readFileSync(join(RAIZ, "data", "candidatos.json"), "utf8")
  )
  return new Set(
    seed
      .filter((c) => {
        const sq = (c.ids as { tse_sq_candidato?: Record<string, string> } | undefined)
          ?.tse_sq_candidato
        return Boolean(sq && Object.values(sq).some(Boolean))
      })
      .map((c) => c.slug)
  )
}

/**
 * Lê o snapshot gerado por `coverage-snapshot.sql`. O SQL não conhece o seed do
 * repo, então `temSqNoSeed` é resolvido aqui.
 */
export function lerSnapshot(path: string, slugs?: Set<string>): CandidatoCoverage[] {
  const bruto = JSON.parse(readFileSync(path, "utf8")) as Omit<CandidatoCoverage, "temSqNoSeed">[]
  const comSq = slugsComSqNoSeed()
  return bruto
    .filter((c) => (slugs ? slugs.has(c.slug) : true))
    .map((c) => ({ ...c, temSqNoSeed: comSq.has(c.slug) }))
}

export async function coletar(opcoes: Opcoes): Promise<CandidatoCoverage[]> {
  if (opcoes.fromSnapshot) return lerSnapshot(opcoes.fromSnapshot, opcoes.slugs)

  const candidatos = await selectAll<CandidatoPublico>(
    "candidatos_publico",
    "id,slug,nome_urna,partido_sigla,cargo_disputado,estado,foto_url,biografia,redes_sociais,idade,naturalidade,formacao,profissao_declarada"
  )

  const [
    historico, mudancas, patrimonio, financiamento, votos, pontos,
    processos, projetos, gastos, legislacao, noticias, posicoes, sancoes,
  ] = await Promise.all([
    selectAll<{ candidato_id: string; cargo_canonico: string | null; tipo_evento: string | null; periodo_inicio: number | null; periodo_fim: number | null }>(
      "historico_politico", "candidato_id,cargo_canonico,tipo_evento,periodo_inicio,periodo_fim"),
    selectAll<{ candidato_id: string }>("mudancas_partido", "candidato_id"),
    selectAll<{ candidato_id: string; ano_eleicao: number; bens: unknown }>("patrimonio", "candidato_id,ano_eleicao,bens"),
    selectAll<{ candidato_id: string; ano_eleicao: number; maiores_doadores: unknown }>("financiamento", "candidato_id,ano_eleicao,maiores_doadores"),
    selectAll<{ candidato_id: string }>("votos_candidato", "candidato_id"),
    selectAll<{ candidato_id: string; categoria: string | null; visivel: boolean | null }>("pontos_atencao", "candidato_id,categoria,visivel"),
    selectAll<{ candidato_id: string }>("processos", "candidato_id"),
    selectAll<{ candidato_id: string; destaque: boolean | null }>("projetos_lei", "candidato_id,destaque"),
    selectAll<{ candidato_id: string; ano: number }>("gastos_parlamentares", "candidato_id,ano"),
    selectAll<{ candidato_id: string }>("legislacao_mandato_executivo", "candidato_id"),
    selectAll<{ candidato_id: string }>("noticias_candidato", "candidato_id"),
    selectAll<{ candidato_id: string; tema: string }>("posicoes_declaradas", "candidato_id,tema"),
    selectAll<{ candidato_id: string }>("sancoes_administrativas", "candidato_id"),
  ])

  const comSq = slugsComSqNoSeed()

  const porHistorico = agruparPorCandidato(historico)
  const porPatrimonio = agruparPorCandidato(patrimonio)
  const porFinanciamento = agruparPorCandidato(financiamento)
  const porGastos = agruparPorCandidato(gastos)
  const porPosicoes = agruparPorCandidato(posicoes)

  const nMudancas = contarPorCandidato(mudancas)
  const nVotos = contarPorCandidato(votos)
  const nProcessos = contarPorCandidato(processos)
  const nProjetos = contarPorCandidato(projetos)
  const nDestaques = contarPorCandidato(projetos, (p) => p.destaque === true)
  const nLegislacao = contarPorCandidato(legislacao)
  const nNoticias = contarPorCandidato(noticias)
  const nSancoes = contarPorCandidato(sancoes)
  // Alertas = pontos de atenção públicos que não são "feito positivo".
  const nAlertas = contarPorCandidato(
    pontos,
    (p) => p.visivel === true && p.categoria !== "feito_positivo"
  )
  const nContradicoes = contarPorCandidato(pontos, (p) => {
    const cat = (p.categoria ?? "").normalize("NFD").replace(/\p{M}/gu, "")
    return p.visivel === true && (cat === "contradicao" || cat === "mudanca_posicao")
  })

  const naoVazio = (v: unknown): boolean => Array.isArray(v) && v.length > 0

  return candidatos
    .filter((c) => (opcoes.slugs ? opcoes.slugs.has(c.slug) : true))
    .map((c) => {
      const pats = porPatrimonio.get(c.id) ?? []
      const fins = porFinanciamento.get(c.id) ?? []
      return {
        slug: c.slug,
        nome_urna: c.nome_urna ?? c.slug,
        partido_sigla: c.partido_sigla,
        cargo_disputado: c.cargo_disputado,
        estado: c.estado,
        foto: Boolean(c.foto_url),
        bio: Boolean(c.biografia),
        redes: temRedes(c.redes_sociais),
        idade: c.idade ?? null,
        naturalidade: c.naturalidade,
        formacao: c.formacao,
        profissao: c.profissao_declarada,
        historico: (porHistorico.get(c.id) ?? []) as HistoricoEvento[],
        temSqNoSeed: comSq.has(c.slug),
        mudancas: nMudancas.get(c.id) ?? 0,
        patrimonioAnos: pats.map((p) => p.ano_eleicao),
        patrimonioAnosComBens: pats.filter((p) => naoVazio(p.bens)).map((p) => p.ano_eleicao),
        financiamentoAnos: fins.map((f) => f.ano_eleicao),
        financiamentoAnosComDoadores: fins
          .filter((f) => naoVazio(f.maiores_doadores))
          .map((f) => f.ano_eleicao),
        votos: nVotos.get(c.id) ?? 0,
        contradicoes: nContradicoes.get(c.id) ?? 0,
        processos: nProcessos.get(c.id) ?? 0,
        alertas: nAlertas.get(c.id) ?? 0,
        projetos: nProjetos.get(c.id) ?? 0,
        destaques: nDestaques.get(c.id) ?? 0,
        gastosAnos: (porGastos.get(c.id) ?? []).map((g) => g.ano),
        legislacaoExecutivo: nLegislacao.get(c.id) ?? 0,
        noticias: nNoticias.get(c.id) ?? 0,
        posicoesTemas: [...new Set((porPosicoes.get(c.id) ?? []).map((p) => p.tema))],
        sancoes: nSancoes.get(c.id) ?? 0,
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
      if (!c.posicoesTemas.includes(w.tema)) c.posicoesTemas = [...c.posicoesTemas, w.tema]
    } else if (w.tabela === "projetos_lei" && w.campos.includes("destaque")) {
      c.destaques += 1
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

function renderTabela(coorte: CandidatoCoverage[], id: string): string {
  const ths = COLUNAS.map((c) => `<th><span class="rot">${esc(c.label)}</span></th>`).join("")
  const acumulado = new Map(COLUNAS.map((c) => [c.key, { got: 0, tot: 0 }]))
  const linhas: string[] = []

  for (const cand of [...coorte].sort((a, b) => a.nome_urna.localeCompare(b.nome_urna, "pt-BR"))) {
    const celulas = calcularCelulas(cand)
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
      return `<td class="c-${cel.state}" data-slug="${esc(cand.slug)}" data-col="${esc(key)}"${tip}>${esc(cel.text)}</td>`
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

const CSS = `
:root { color-scheme: light;
  --bg:#fafaf8; --fg:#1a1a1a; --muted:#6b6b6b; --line:#e4e2dc; --card:#ffffff;
  --ok-bg:#e3f2e6; --ok-fg:#1c6b2d; --partial-bg:#fdf3d7; --partial-fg:#8a6100;
  --miss-bg:#fbe4e4; --miss-fg:#a12622; --zero-bg:#f1f1ee; --zero-fg:#7a7a74;
  --na-bg:#f7f7f5; --na-fg:#b3b3ad; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:32px 24px 80px; }
main { max-width:1500px; margin:0 auto; }
h1 { font-size:26px; margin:0 0 4px; letter-spacing:-0.01em; }
.sub { color:var(--muted); margin:0 0 20px; }
h2 { font-size:18px; margin:44px 0 10px; }
h2 .count { font-size:13px; color:var(--muted); font-weight:600; margin-left:6px; }
.legend { display:flex; flex-wrap:wrap; gap:8px 14px; margin:14px 0 6px; font-size:12.5px; }
.legend span { display:inline-flex; align-items:center; gap:6px; }
.sw { width:14px; height:14px; border-radius:4px; display:inline-block; }
.notes { font-size:12.5px; color:var(--muted); max-width:980px; margin:10px 0 4px; }
.notes li { margin-bottom:3px; }
.toc { display:flex; flex-wrap:wrap; gap:6px; margin:18px 0 8px; }
.chip { padding:4px 10px; border:1px solid var(--line); border-radius:999px; font-size:12.5px;
  font-weight:600; color:var(--fg); text-decoration:none; background:var(--card); }
.chip:hover { border-color:var(--muted); }
.twrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--card); }
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
td.c-na { background:var(--na-bg); color:var(--na-fg); font-size:11px; }
td.scr { font-weight:700; border-right:1px solid var(--line); }
.s-hi { color:var(--ok-fg); } .s-mid { color:var(--partial-fg); } .s-lo { color:var(--miss-fg); }
tfoot td, tfoot th { border-top:1px solid var(--line); font-size:11px; color:var(--muted); padding:6px; }
tfoot th.cand { text-align:left; }
.pend { background:#eef4fd; border:1px solid #cddffa; border-radius:8px; padding:10px 14px;
  font-size:12.5px; margin:16px 0 0; }
`

export function renderHtml(coorte: CandidatoCoverage[], pendentes: PendingWrite[]): string {
  const presidentes = coorte.filter((c) => c.cargo_disputado === "Presidente")
  const governadores = coorte.filter((c) => c.cargo_disputado === "Governador")
  const ufs = [...new Set(governadores.map((c) => c.estado).filter(Boolean) as string[])].sort()

  const toc =
    `<a href="#presidentes" class="chip">Presidente</a>` +
    ufs.map((uf) => `<a href="#uf-${uf.toLowerCase()}" class="chip">${uf}</a>`).join("")

  const secoes = [
    `<h2 id="presidentes">Pré-candidatos a Presidente <span class="count">${presidentes.length}</span></h2>` +
      renderTabela(presidentes, "t-pres"),
    ...ufs.map((uf) => {
      const cs = governadores.filter((c) => c.estado === uf)
      return (
        `<h2 id="uf-${uf.toLowerCase()}">${uf} · ${UF_NOME[uf] ?? uf} — Governador <span class="count">${cs.length}</span></h2>` +
        renderTabela(cs, `t-${uf.toLowerCase()}`)
      )
    }),
  ]

  const blocoPendentes = pendentes.length
    ? `<div class="pend"><b>Migrations pendentes sobrepostas:</b> ${pendentes.length} write(s) anotado(s) com <code>-- @write</code> em <code>supabase/migrations/</code> ainda não aplicado(s) em produção. O relatório mostra a cobertura <b>depois</b> da aplicação. Nada foi escrito no banco por este script.</div>`
    : ""

  const data = new Date().toLocaleDateString("pt-BR")

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
<p class="sub">Snapshot do banco de produção em ${data}. Somente perfis públicos no site:
${presidentes.length} pré-candidatos a Presidente e ${governadores.length} a Governador em ${ufs.length} UFs.
Gerado por <code>scripts/audit/coverage-report.ts</code>.</p>

<div class="legend">
  <span><span class="sw" style="background:var(--ok-bg)"></span>Preenchido (número = volume)</span>
  <span><span class="sw" style="background:var(--partial-bg)"></span>Parcial</span>
  <span><span class="sw" style="background:var(--miss-bg)"></span>Esperado e vazio</span>
  <span><span class="sw" style="background:var(--zero-bg)"></span>Zero (nada encontrado ou não coletado)</span>
  <span><span class="sw" style="background:var(--na-bg)"></span>Não se aplica</span>
</div>
<ul class="notes">
  <li><b>Não se aplica</b> é inferido do histórico político registrado no próprio site: cota parlamentar exige mandato de deputado federal ou senador com fim a partir de 2009 (quando começa a cota digital do CEAP); votações-chave, mandato federal com fim a partir de 2012 (janela das votações carregadas no banco); projetos de lei, mandato parlamentar em qualquer esfera; legislação do Executivo, chefia de Executivo; patrimônio e financiamento, já ter declarado ao TSE, isto é, SQ_CANDIDATO conhecido no seed do projeto ou candidatura / mandato eletivo no histórico com início até 2024. A pré-candidatura de 2026 não conta, e cargo por nomeação (ministro, secretário, presidência de partido) também não. Histórico incompleto pode gerar falso "não se aplica".</li>
  <li><b>Zero</b> (cargos ocupados, trocas de partido, contradições, processos, alertas, sanções): pode significar "verificado e nada encontrado" ou "ainda não coletado", o banco não distingue os dois casos.</li>
  <li><b>Preenchimento</b>: entram no índice exatamente 15 colunas: foto, bio, redes sociais, dados pessoais (cheio com 3 de 4 ou mais), patrimônio, evolução patrimonial, bens ano a ano, financiamento, doadores detalhados, votações-chave, projetos de lei, cota parlamentar, legislação do Executivo, notícias e posições (quiz). Só contam as aplicáveis ao candidato; parcial vale meio ponto. Ficam fora as seis colunas de zero acima e "proj. em destaque" (curadoria editorial), por isso pode haver 100% com célula amarela de destaque.</li>
  <li>Alertas contam pontos de atenção visíveis que não sejam "feito positivo". Dados pessoais = idade (da view pública <code>candidatos_publico</code>, derivada da data de nascimento), naturalidade, formação e profissão. Posições (quiz) é x/3, um por tema do quiz presidencial.</li>
</ul>
${blocoPendentes}
<nav class="toc">${toc}</nav>
${secoes.join("")}
</main>
</body>
</html>`
}

// ── main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opcoes = parseArgs(process.argv.slice(2))

  const pendentes = opcoes.comPendentes
    ? lerPendingWrites(join(RAIZ, "supabase", "migrations"), opcoes.migrationsDesde)
    : []

  let coorte = await coletar(opcoes)
  if (pendentes.length) {
    const r = aplicarPendentes(coorte, pendentes)
    coorte = r.coorte
    console.error(`[cobertura] ${r.aplicados} write(s) pendente(s) sobreposto(s)`)
  }

  const html = renderHtml(coorte, pendentes)
  mkdirSync(dirname(opcoes.out), { recursive: true })
  writeFileSync(opcoes.out, html, "utf8")
  console.error(`[cobertura] HTML: ${opcoes.out} (${html.length} bytes)`)

  if (opcoes.json) {
    const dump = coorte.map((c) => ({
      slug: c.slug,
      nome_urna: c.nome_urna,
      cargo_disputado: c.cargo_disputado,
      estado: c.estado,
      celulas: Object.fromEntries(
        Object.entries(calcularCelulas(c)).map(([k, v]) => [k, v.state])
      ),
      indice: calcularIndice(calcularCelulas(c)),
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
