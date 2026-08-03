/** Confere as anotações @write das migrations desta coorte contra a allowlist exata. */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

type Entry = Record<string, string | number>
const ROOT = process.cwd()
const ALLOW = join(ROOT, "scripts", "audit", "allowlist-governadores-al.json")
const MIG_DIR = join(ROOT, "supabase", "migrations")
function main(): void {
  const raw = JSON.parse(readFileSync(ALLOW, "utf8")) as { entries: Entry[] }
  const allowed = raw.entries.filter((x) => x.disposition === "migration")
  const seen: Entry[] = []
  for (const file of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && /governadores[-_]al/.test(x))) {
    const text = readFileSync(join(MIG_DIR, file), "utf8")
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("@write")) continue
      const item = Object.fromEntries([...lines[i].matchAll(/(table|slug|ano|tema|field)=([^\s]+)/g)].map((m) => [m[1], m[2]])) as Entry
      const match = allowed.find((x) => Object.entries(item).every(([k, v]) => String(x[k]) === String(v)))
      if (!match) { console.error(`FAIL ${file}:${i + 1} annotation fora da allowlist`); process.exitCode = 1; continue }
      const block = lines.slice(i, i + 24).join("\n")
      if (!block.includes(`public.${String(item.table)}`) || !block.includes(`'${String(item.slug)}'`)) { console.error(`FAIL ${file}:${i + 1} statement não ancora tabela/slug`); process.exitCode = 1 }
      seen.push(item)
    }
  }
  for (const x of allowed) if (!seen.some((y) => Object.entries(x).filter(([k]) => k !== "disposition").every(([k, v]) => String(y[k]) === String(v)))) { console.error(`FAIL migration permitida ausente: ${JSON.stringify(x)}`); process.exitCode = 1 }
  if (process.exitCode) process.exit(1)
  console.log(`OK: ${seen.length} writes anotadas e conferidas contra allowlist.`)
}
main()
