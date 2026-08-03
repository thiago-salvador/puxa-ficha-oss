/**
 * Régua versionada de cobertura para a coorte de governadores.
 *
 * O script trabalha sobre um snapshot local de leitura e sobre as anotações
 * das migrations pendentes. Nunca abre conexão com o banco nem aplica SQL.
 *
 * Uso: tsx scripts/audit/coverage-report.ts --uf AL
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const VISUAL = join(process.env.HOME ?? ".", ".disposable-html", "2026-08-02-puxa-ficha-cobertura-dados.descartavel.html")
const COLS = [
  ["foto", "Foto"],
  ["bio", "Bio"],
  ["redes", "Redes"],
  ["dados", "Dados pessoais"],
  ["patrimonio", "Patrimônio"],
  ["evolucao", "Evolução"],
  ["bens", "Bens ano a ano"],
  ["financiamento", "Financiamento"],
  ["doadores", "Doadores"],
  ["votacoes", "Votações"],
  ["projetos", "Projetos"],
  ["cota", "Cota"],
  ["legislacao_exec", "Legislação Executivo"],
  ["noticias", "Notícias"],
  ["posicoes_quiz", "Posições quiz"],
] as const
type State = "ok" | "partial" | "missing" | "zero" | "na"
type Cell = { state: State; value: string; title?: string }
type Candidate = {
  slug: string
  nome_urna: string
  partido_sigla: string | null
  estado: string
  foto: boolean
  bio: boolean
  redes: boolean
  dados: number
  patrimonio_anos: number[]
  bens_anos: number[]
  financiamento_anos: number[]
  doadores_anos: number[]
  votos: number
  projetos: number
  gastos: number
  legislacao_exec: number
  noticias: number
  posicoes_temas: string[]
  temas_quiz: string[]
  has_federal_mandato: boolean
  has_parliamentary_mandato: boolean
  has_executive_mandato: boolean
}
type Annotation = { table: string; slug: string; ano?: number; tema?: string; field?: string }

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function annotations(): Annotation[] {
  const dir = join(ROOT, "supabase", "migrations")
  if (!existsSync(dir)) return []
  const out: Annotation[] = []
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const text = readFileSync(join(dir, name), "utf8")
    for (const line of text.split("\n")) {
      if (!line.includes("@write")) continue
      const fields = Object.fromEntries(
        [...line.matchAll(/(table|slug|ano|tema|field)=([^\s]+)/g)].map((m) => [m[1], m[2]])
      ) as Record<string, string>
      if (fields.table && fields.slug) {
        out.push({
          table: fields.table,
          slug: fields.slug,
          tema: fields.tema,
          field: fields.field,
          ano: fields.ano ? Number(fields.ano) : undefined,
        })
      }
    }
  }
  return out
}

function load(uf: string): { captured_at: string; candidatos: Candidate[] } {
  const path = arg("--snapshot", join(ROOT, "scripts", "audit", "snapshots", `governadores-${uf.toLowerCase()}-coverage.json`))!
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as { captured_at: string; candidatos: Candidate[] }
  return { captured_at: raw.captured_at, candidatos: raw.candidatos.filter((c) => c.estado === uf) }
}

function withPending(base: Candidate, pending: Annotation[]): Candidate {
  const c: Candidate = JSON.parse(JSON.stringify(base)) as Candidate
  for (const a of pending.filter((x) => x.slug === c.slug)) {
    if (a.table === "posicoes_declaradas" && a.tema && !c.posicoes_temas.includes(a.tema)) c.posicoes_temas.push(a.tema)
    if (a.table === "patrimonio" && a.ano && !c.patrimonio_anos.includes(a.ano)) {
      c.patrimonio_anos.push(a.ano)
      c.bens_anos.push(a.ano)
    }
    if (a.table === "financiamento" && a.ano && !c.financiamento_anos.includes(a.ano)) {
      c.financiamento_anos.push(a.ano)
      c.doadores_anos.push(a.ano)
    }
    if (a.table === "candidatos" && a.field === "profissao_declarada") c.dados = Math.max(c.dados, 4)
  }
  for (const key of ["patrimonio_anos", "bens_anos", "financiamento_anos", "doadores_anos"] as const) c[key].sort((a, b) => a - b)
  return c
}

function cell(state: State, value: string, title?: string): Cell {
  return { state, value, title }
}

function cells(c: Candidate): Record<string, Cell> {
  const allTse = c.patrimonio_anos.length > 0 || c.financiamento_anos.length > 0
  const personal = c.dados >= 3 ? cell("ok", `${c.dados}/4`) : c.dados > 0 ? cell("partial", `${c.dados}/4`) : cell("missing", "0/4", "fonte não encontrada")
  const years = (items: number[], label: string): Cell => items.length ? cell("ok", `${items.length} ano${items.length === 1 ? "" : "s"}`) : c.has_federal_mandato || allTse ? cell("missing", "—", `${label}: esperado e vazio`) : cell("na", "n/a")
  const positions = c.temas_quiz.length ? `${c.posicoes_temas.filter((x) => c.temas_quiz.includes(x)).length}/${c.temas_quiz.length}` : "0/0"
  const out: Record<string, Cell> = {
    foto: c.foto ? cell("ok", "✓") : cell("missing", "—"),
    bio: c.bio ? cell("ok", "✓") : cell("missing", "—"),
    redes: c.redes ? cell("ok", "✓") : cell("missing", "—"),
    dados: personal,
    patrimonio: years(c.patrimonio_anos, "patrimônio"),
    evolucao: c.patrimonio_anos.length >= 2 ? cell("ok", "✓") : c.patrimonio_anos.length ? cell("partial", "—") : cell("missing", "—"),
    bens: c.patrimonio_anos.length && c.bens_anos.length === c.patrimonio_anos.length ? cell("ok", `${c.bens_anos.length}/${c.patrimonio_anos.length}`) : c.patrimonio_anos.length ? cell("missing", `${c.bens_anos.length}/${c.patrimonio_anos.length}`) : cell("na", "n/a"),
    financiamento: years(c.financiamento_anos, "financiamento"),
    doadores: c.financiamento_anos.length && c.doadores_anos.length === c.financiamento_anos.length ? cell("ok", `${c.doadores_anos.length}/${c.financiamento_anos.length}`) : c.financiamento_anos.length ? cell("missing", `${c.doadores_anos.length}/${c.financiamento_anos.length}`) : cell("na", "n/a"),
    votacoes: c.has_federal_mandato ? (c.votos ? cell("ok", String(c.votos)) : cell("missing", "0", "mandato federal aplicável; esperado e vazio")) : cell("na", "n/a"),
    projetos: c.has_parliamentary_mandato ? (c.projetos ? cell("ok", String(c.projetos)) : cell("missing", "0")) : cell("na", "n/a"),
    cota: c.has_federal_mandato ? (c.gastos ? cell("ok", `${c.gastos} ano${c.gastos === 1 ? "" : "s"}`) : cell("missing", "0", "mandato federal aplicável; sem coleta neste run")) : cell("na", "n/a"),
    legislacao_exec: c.has_executive_mandato ? (c.legislacao_exec ? cell("ok", String(c.legislacao_exec)) : cell("missing", "—")) : cell("na", "n/a"),
    noticias: c.noticias ? cell("ok", String(c.noticias)) : cell("missing", "—"),
    posicoes_quiz: c.temas_quiz.length && c.posicoes_temas.filter((x) => c.temas_quiz.includes(x)).length === c.temas_quiz.length ? cell("ok", positions) : cell("missing", positions, "tema sem posição ou sem declaração encontrada"),
  }
  return out
}

function score(row: Record<string, Cell>): string {
  const applicable = COLS.map(([key]) => row[key]).filter((x) => x.state !== "na")
  if (!applicable.length) return "0%"
  const points = applicable.reduce((sum, x) => sum + (x.state === "ok" ? 1 : x.state === "partial" ? 0.5 : 0), 0)
  return `${Math.round((points / applicable.length) * 100)}%`
}

function renderTable(uf: string, candidatos: Candidate[]): string {
  const header = COLS.map(([, label]) => `<th><span class="rot">${esc(label)}</span></th>`).join("")
  const rows = candidatos.map((c) => {
    const row = cells(c)
    const total = score(row)
    const tds = COLS.map(([key]) => {
      const x = row[key]
      return `<td class="c-${x.state}" data-slug="${esc(c.slug)}" data-col="${esc(key)}"${x.title ? ` title="${esc(x.title)}"` : ""}>${esc(x.value)}</td>`
    }).join("")
    return `<tr data-slug="${esc(c.slug)}"><th scope="row" class="cand"><a href="https://puxaficha.com.br/candidato/${esc(c.slug)}" target="_blank" rel="noopener">${esc(c.nome_urna)}</a><span class="party">${esc(c.partido_sigla ?? "")}</span></th><td class="scr s-hi" data-slug="${esc(c.slug)}" data-col="indice">${total}</td>${tds}</tr>`
  }).join("")
  const title = `${uf} · Alagoas — Governador`
  return `<h2 id="uf-${uf.toLowerCase()}">${esc(title)} <span class="count">${candidatos.length}</span></h2><div class="twrap"><table id="t-${uf.toLowerCase()}" data-uf="${esc(uf)}"><thead><tr><th class="cand">Candidato</th><th><span class="rot">Preenchimento</span></th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`
}

function baseDocument(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Puxa Ficha · Cobertura</title><style>:root{color-scheme:light;--bg:#fff;--fg:#1d1d1f;--muted:#666;--ok:#d9f2df;--partial:#fff2c7;--missing:#fbe4e4;--na:#f5f5f2}*{box-sizing:border-box}body{margin:0;padding:28px;background:#fff;color:#1d1d1f;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto}.twrap{overflow:auto}table{border-collapse:collapse;min-width:1200px}th,td{border:1px solid #ddd;padding:6px;text-align:center;white-space:nowrap}.cand{text-align:left;min-width:190px}.cand a{color:#174a8b}.party{display:block;color:#666;font-size:11px}.rot{writing-mode:vertical-rl;transform:rotate(180deg);display:inline-block;height:120px}.c-ok{background:var(--ok)}.c-partial{background:var(--partial)}.c-missing{background:var(--missing)}.c-zero{background:#eee}.c-na{background:var(--na);color:#888}.scr{font-weight:700}h1{margin-top:0}.chip{display:inline-block;margin:3px;padding:4px 8px;border:1px solid #aaa;border-radius:12px}.legend{margin:12px 0;color:#444}</style></head><body><main><h1>Puxa Ficha · Cobertura de dados por candidato</h1><p class="legend">Régua versionada: preenchido, parcial, esperado-e-vazio, zero e não se aplica. O índice usa exatamente 15 colunas aplicáveis; preenchido vale 1 ponto e parcial vale meio ponto.</p><nav class="toc"></nav></main></body></html>`
}

function merge(html: string, uf: string, table: string): string {
  const section = new RegExp(`<h2 id="uf-${uf.toLowerCase()}">[\\s\\S]*?(?=<h2 id=|</main>)`)
  const next = section.test(html) ? html.replace(section, table) : html.replace("</main>", `${table}</main>`)
  return next.replace(/<meta name="color-scheme" content="dark">/g, '<meta name="color-scheme" content="light">').replace(/:root\s*\{[^}]*color-scheme:\s*dark[^}]*\}/g, ":root{color-scheme:light}")
}

function main(): void {
  const uf = (arg("--uf", "AL") ?? "AL").toUpperCase()
  const snapshot = load(uf)
  const candidatos = snapshot.candidatos.map((c) => withPending(c, annotations()))
  const output = resolve(arg("--output", VISUAL)!)
  mkdirSync(dirname(output), { recursive: true })
  const existing = existsSync(output) ? readFileSync(output, "utf8") : baseDocument()
  const html = merge(existing, uf, renderTable(uf, candidatos))
  writeFileSync(output, html)
  console.log(JSON.stringify({ output, uf, slugs: candidatos.map((c) => c.slug), captured_at: snapshot.captured_at, columns: COLS.length, pending_annotations: annotations().length }))
}

main()
