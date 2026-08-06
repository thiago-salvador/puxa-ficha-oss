import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const routes = [
  {
    label: "/candidato/[slug]",
    path: "src/app/(site)/candidato/[slug]/page.tsx",
  },
  {
    label: "/embed/[slug]",
    path: "src/app/(embed)/embed/[slug]/page.tsx",
  },
] as const

const densityBypassSlugs = [
  "augusto-cury",
  "cabo-daciolo",
  "edmilson-costa",
  "marcelo-brigadeiro",
  "natasha-slhessarenko",
  "renan-santos",
] as const

describe("candidate dynamic route build contract", () => {
  for (const route of routes) {
    const src = readFileSync(join(root, route.path), "utf8")

    it(`${route.label} is request-rendered and does not pre-render the full candidate catalog`, () => {
      assert.match(src, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/)
      assert.doesNotMatch(src, /export\s+async\s+function\s+generateStaticParams/)
      assert.doesNotMatch(src, /getCandidatoSlugStaticParams/)
    })
  }

  it("remove o bypass de release-verify sem ler headers no caminho da ficha", () => {
    const api = stripComments(readFileSync(join(root, "src/lib/api.ts"), "utf8"))
    assert.doesNotMatch(api, /await\s+headers\s*\(\s*\)/)
    assert.doesNotMatch(api, /from\s+["']next\/headers["']/)
    assert.doesNotMatch(api, /x-pf-release-verify-cache-bypass/)
    assert.doesNotMatch(api, /resolveReleaseVerifyCacheBypassToken/)
  })

  it("preserva exatamente os seis slugs editoriais fora do Data Cache", () => {
    const api = stripComments(readFileSync(join(root, "src/lib/api.ts"), "utf8"))
    const setBody = api.match(/PUBLIC_PROFILE_DENSITY_BYPASS_SLUGS\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/)?.[1]
    assert.ok(setBody, "lista de slugs especiais precisa existir")
    const slugs = [...setBody.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]).sort()
    assert.deepEqual(slugs, [...densityBypassSlugs].sort())
    assert.match(api, /PUBLIC_PROFILE_DENSITY_BYPASS_SLUGS\.has\(slug\)[\s\S]*?noStore\(\)/)
  })

  it("/api/candidato-slugs remains the public full-slug inventory", () => {
    const apiRoute = readFileSync(join(root, "src/app/api/candidato-slugs/route.ts"), "utf8")
    assert.match(apiRoute, /getCandidatoSlugStaticParams/)
  })
})
