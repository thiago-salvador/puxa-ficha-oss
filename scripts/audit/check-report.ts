/** Asserções locais sobre o HTML gerado por coverage-report.ts. Não toca banco. */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const DEFAULT_REPORT = join(process.env.HOME ?? ".", ".disposable-html", "2026-08-02-puxa-ficha-cobertura-dados.descartavel.html")
const TSE = new Set(["patrimonio", "evolucao", "bens", "financiamento", "doadores"])
const ALIASES: Record<string, string> = { gastos: "cota", votacoes_chave: "votacoes", posicoes: "posicoes_quiz", "legislacao-executivo": "legislacao_exec" }
type Entry = { slug: string; ano?: number; reason?: string; coluna?: string; campo?: string }

function flag(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
function list(name: string): string[] { return (flag(name) ?? "").split(",").map((x) => x.trim()).filter(Boolean) }
function readJson(path: string): Entry[] {
  if (!existsSync(path)) return []
  const raw = JSON.parse(readFileSync(path, "utf8")) as { entries?: Entry[] }
  return raw.entries ?? []
}
function pending(slug: string, col: string): boolean {
  const dir = join(ROOT, "supabase", "migrations")
  if (!existsSync(dir)) return false
  const files = require("node:fs").readdirSync(dir) as string[]
  return files.filter((x) => x.endsWith(".sql")).some((name) => {
    const text = readFileSync(join(dir, name), "utf8")
    return text.includes("@write") && text.includes(`slug=${slug}`) && (text.includes(`table=${col}`) || (col === "cota" && text.includes("table=gastos_parlamentares")))
  })
}
function desfecho(slug: string, col: string): string | null {
  const sq = readJson(join(ROOT, "data", "sq-exceptions.json"))
  if (TSE.has(col) && sq.some((x) => x.slug === slug && String(x.reason ?? "").includes("no-"))) return "data/sq-exceptions.json"
  const editorial = readJson(join(ROOT, "scripts", "audit", "editorial-exceptions.json"))
  const found = editorial.find((x) => x.slug === slug && (x.coluna === col || x.campo === col))
  if (found) return "scripts/audit/editorial-exceptions.json"
  if (pending(slug, col)) return "migration anotada com @write"
  return null
}
function cells(html: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const row of html.matchAll(/<tr data-slug="([^"]+)">([\s\S]*?)<\/tr>/g)) {
    const cols = new Map<string, string>()
    for (const cell of row[2].matchAll(/<td class="c-(ok|partial|missing|zero|na)"[^>]*data-col="([^"]+)"/g)) cols.set(cell[2], `c-${cell[1]}`)
    out.set(row[1], cols)
  }
  return out
}
function fail(message: string): never { console.error(`FAIL: ${message}`); process.exit(1) }

function main(): void {
  const report = flag("--report") ?? DEFAULT_REPORT
  if (!existsSync(report)) fail(`relatório ausente: ${report}`)
  const html = readFileSync(report, "utf8")
  const uf = flag("--uf")?.toLowerCase()
  if (uf && !html.includes(`id="uf-${uf}"`)) fail(`seção uf-${uf} ausente`)
  const all = cells(html)
  const slugs = list("--slug").concat(list("--slugs"))
  const wanted = slugs.length ? [...new Set(slugs)] : [...all.keys()].filter((s) => !uf || new RegExp(`data-slug="${s}"`).test(html))
  let failures = 0
  const cols = list("--cols").map((x) => ALIASES[x] ?? x)
  const expected = flag("--expect")
  if (expected) {
    for (const slug of wanted) for (const col of cols) {
      const got = all.get(slug)?.get(col)
      if (got !== expected) { console.error(`FAIL ${slug}.${col}: esperado ${expected}, encontrado ${got ?? "ausente"}`); failures++ }
      else console.log(`OK ${slug}.${col}=${got}`)
    }
  }
  if (process.argv.includes("--fail-on-correctable-missing")) {
    for (const slug of wanted) for (const [col, state] of all.get(slug) ?? []) if (state === "c-missing") {
      const why = desfecho(slug, col)
      if (why) console.log(`OK ${slug}.${col}=c-missing desfecho=${why}`)
      else { console.error(`FAIL ${slug}.${col}=c-missing sem desfecho`); failures++ }
    }
  }
  if (!expected && !process.argv.includes("--fail-on-correctable-missing")) fail("nada a checar")
  if (failures) process.exit(1)
  console.error("OK: todas as asserções passaram.")
}
main()
