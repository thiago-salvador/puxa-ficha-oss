import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const requestRenderedRoutes = [
  {
    label: "/embed/[slug]",
    path: "src/app/(embed)/embed/[slug]/page.tsx",
  },
] as const

describe("candidate dynamic route build contract", () => {
  for (const route of requestRenderedRoutes) {
    const src = readFileSync(join(root, route.path), "utf8")

    it(`${route.label} is request-rendered and does not pre-render the full candidate catalog`, () => {
      assert.match(src, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/)
      assert.doesNotMatch(src, /export\s+async\s+function\s+generateStaticParams/)
      assert.doesNotMatch(src, /getCandidatoSlugStaticParams/)
    })
  }

  /**
   * A ficha deixou de ser `force-dynamic`. O motivo original documentado na
   * propria rota era o `await headers()` do RootLayout, que tornava toda pagina
   * dinamica; com o nonce de CSP removido do middleware esse motivo nao existe
   * mais, e mante-la dinamica custava um render de funcao por VISITA na rota que
   * um video viral mais concentra.
   *
   * O que este bloco preserva e a outra metade do contrato original, que
   * continua valendo: a rota NAO pode pre-renderizar o catalogo inteiro no
   * build. `generateStaticParams` existe porque sem ela o Next 16 marca a rota
   * como dinamica e serve `private, no-store`, mas ela devolve lista vazia, de
   * modo que as fichas sao geradas sob demanda e so entao cacheadas.
   */
  describe("/candidato/[slug]", () => {
    const src = readFileSync(join(root, "src/app/(site)/candidato/[slug]/page.tsx"), "utf8")

    it("e cacheavel: tem revalidate e nao e force-dynamic", () => {
      assert.match(src, /export\s+const\s+revalidate\s*=\s*\d+/)
      assert.doesNotMatch(src, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/)
    })

    it("nao pre-renderiza o catalogo de candidatos no build", () => {
      assert.match(src, /export\s+async\s+function\s+generateStaticParams/)
      // A lista precisa ser literalmente vazia. Qualquer fonte de slugs aqui
      // devolve o build para ~13 queries por ficha vezes o catalogo inteiro.
      assert.match(src, /return\s*\[\s*\]/)
      assert.doesNotMatch(src, /getCandidatoSlugStaticParams/)
    })
  })

  it("/api/candidato-slugs remains the public full-slug inventory", () => {
    const apiRoute = readFileSync(join(root, "src/app/api/candidato-slugs/route.ts"), "utf8")
    assert.match(apiRoute, /getCandidatoSlugStaticParams/)
  })
})
