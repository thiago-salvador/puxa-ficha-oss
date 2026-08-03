/**
 * Relatório de cobertura de dados por candidato (2026-08-02).
 *
 * Mede **o que o leitor vê em puxaficha.com.br**, não o que existe no banco.
 * Onde os dois divergem, vale a superfície pública:
 *   - posição só conta quando `verificado = true`, que é o filtro do quiz;
 *   - destaque só conta quando cai nos 25 projetos que a ficha carrega;
 *   - ponto de atenção só conta quando `visivel = true`.
 * O que está no banco esperando decisão humana não vira verde: vira item na
 * coluna "Itens a revisar", com página própria para aprovar ou rejeitar.
 *
 * A régua (cinco estados de célula, aplicabilidade, índice de 15 colunas) vive
 * em `lib/coverage-model.ts`; este arquivo só monta e desenha.
 *
 * Não escreve em banco. Os efeitos colaterais são o HTML de saída, o JSON irmão
 * (com `--json`) e as páginas de revisão em `<dir do HTML>/revisao/`.
 *
 * A entrada é sempre o snapshot JSON de `coverage-snapshot.sql`, rodado contra o
 * banco em modo somente leitura (psql, SQL editor do Supabase ou MCP) e salvo em
 * arquivo. Ver `--from-snapshot`.
 *
 * Uso:
 *   tsx scripts/audit/coverage-report.ts --from-snapshot=snapshot.json --json
 *   tsx scripts/audit/coverage-report.ts --from-snapshot=snapshot.json --com-migrations-pendentes
 *
 * Flags:
 *   --from-snapshot=PATH        OBRIGATÓRIA. JSON produzido por `coverage-snapshot.sql`
 *   --out=PATH                  caminho do HTML (default: ~/.disposable-html/AAAA-MM-DD-puxa-ficha-cobertura-dados.descartavel.html)
 *   --json[=PATH]               grava também o JSON de estados por célula
 *   --review-post=URL           endpoint para onde as páginas de revisão enviam
 *                               as decisões (default: /revisao)
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
  calcularCelulas,
  calcularIndice,
  type CandidatoCoverage,
  type Cell,
  type ItemRevisar,
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
  reviewPost: string
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
    reviewPost: get("review-post") || "/revisao",
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
      // A célula de revisão vira link para a página de decisão do candidato.
      const conteudo =
        key === "revisar" && cand.itensRevisar.length > 0
          ? `<a class="rev" href="revisao/${esc(cand.slug)}.html">${esc(cel.text)}</a>`
          : esc(cel.text)
      return `<td class="c-${cel.state}" data-slug="${esc(cand.slug)}" data-col="${esc(key)}"${tip}>${conteudo}</td>`
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
a.rev { color:var(--warn-link, #1f4fd8); font-weight:700; text-decoration:none; }
a.rev:hover { text-decoration:underline; }
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
  // Nenhum perfil público pode escapar do guia: quem não é Presidente nem
  // Governador (hoje, vice-governadores) entra numa seção própria.
  const outros = coorte.filter(
    (c) => c.cargo_disputado !== "Presidente" && c.cargo_disputado !== "Governador"
  )

  const toc =
    `<a href="#presidentes" class="chip">Presidente</a>` +
    ufs.map((uf) => `<a href="#uf-${uf.toLowerCase()}" class="chip">${uf}</a>`).join("") +
    (outros.length ? `<a href="#outros" class="chip">Outros cargos</a>` : "")

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
    ...(outros.length
      ? [
          `<h2 id="outros">Outros cargos <span class="count">${outros.length}</span></h2>` +
            renderTabela(outros, "t-outros"),
        ]
      : []),
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
<p class="sub">O que o leitor vê em <a href="https://puxaficha.com.br" target="_blank" rel="noopener">puxaficha.com.br</a>, medido em ${data}.
${presidentes.length} pré-candidatos a Presidente, ${governadores.length} a Governador em ${ufs.length} UFs${outros.length ? ` e ${outros.length} em outros cargos` : ""}.
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

// ── main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opcoes = parseArgs(process.argv.slice(2))
  if (!opcoes.fromSnapshot) {
    throw new Error(
      "--from-snapshot=PATH é obrigatório. Rode scripts/audit/coverage-snapshot.sql contra o banco " +
        "(somente leitura) e salve a coluna `snapshot` num arquivo .json."
    )
  }
  NOME_INDEX = basename(opcoes.out)

  const pendentes = opcoes.comPendentes
    ? lerPendingWrites(join(RAIZ, "supabase", "migrations"), opcoes.migrationsDesde)
    : []

  let coorte = lerSnapshot(opcoes.fromSnapshot, opcoes.slugs)
  if (pendentes.length) {
    const r = aplicarPendentes(coorte, pendentes)
    coorte = r.coorte
    console.error(`[cobertura] ${r.aplicados} write(s) pendente(s) sobreposto(s)`)
  }

  const html = renderHtml(coorte, pendentes)
  mkdirSync(dirname(opcoes.out), { recursive: true })
  writeFileSync(opcoes.out, html, "utf8")
  console.error(`[cobertura] HTML: ${opcoes.out} (${html.length} bytes)`)

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
  console.error(`[cobertura] revisão: ${paginas} página(s), ${itens} item(ns) em ${dirRevisao}`)

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
