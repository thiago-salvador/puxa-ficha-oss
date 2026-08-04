import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Remove comentarios antes de assercoes negativas.
 *
 * Sem isto, um guard do tipo "este arquivo nao pode conter X" dispara no
 * comentario que EXPLICA por que X foi removido, o que e exatamente o oposto do
 * que se quer travar. O objetivo e o codigo, nao a prosa.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

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

  describe("/candidato/[slug]", () => {
    const src = readFileSync(join(root, "src/app/(site)/candidato/[slug]/page.tsx"), "utf8")

    it("e servida do cache: tem revalidate e nao e force-dynamic", () => {
      assert.match(src, /export\s+const\s+revalidate\s*=\s*\d+/)
      assert.doesNotMatch(src, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/)
    })

    it("nao pre-renderiza o catalogo de candidatos no build", () => {
      assert.match(src, /export\s+async\s+function\s+generateStaticParams/)
      // Lista literalmente vazia. Qualquer fonte de slugs aqui devolveria o
      // build para ~13 queries por ficha vezes o catalogo inteiro, a cada deploy.
      assert.match(src, /return\s*\[\s*\]/)
      assert.doesNotMatch(src, /getCandidatoSlugStaticParams/)
    })
  })

  /**
   * Guard de regressao do incidente de 2026-08-03 (PR #70, revertido em
   * `c0ef9a7`): `getCandidatoBySlugResource` lia `headers()` no bypass de
   * release-verify, e as env vars que ligam esse bypass estao setadas em
   * producao. Numa rota estatica isso vira `app-static-to-dynamic-error`, ou
   * seja HTTP 500 em TODA ficha. Enquanto `/candidato/[slug]` for cacheada,
   * nada no caminho de dados dela pode ler headers em runtime.
   */
  it("o caminho de dados da ficha nao le headers() em runtime", () => {
    const api = stripComments(readFileSync(join(root, "src/lib/api.ts"), "utf8"))
    assert.doesNotMatch(api, /await\s+headers\s*\(\s*\)/)
    assert.doesNotMatch(api, /from\s+"next\/headers"/)
    assert.doesNotMatch(api, /x-pf-release-verify-cache-bypass/)
  })

  /**
   * Segundo gatilho do MESMO erro, e o que passou batido na primeira tentativa.
   *
   * `noStore()` derruba uma rota estatica igualzinho a `headers()`: dispara
   * `app-static-to-dynamic-error` e a resposta vira HTTP 500. Havia uma lista de
   * 6 slugs (`PUBLIC_PROFILE_DENSITY_BYPASS_SLUGS`) que chamava `noStore()` por
   * slug, e as seis fichas respondiam 500, duas delas de presidenciaveis.
   *
   * Com ISR nao existe render sem cache por slug na mesma rota: `noStore()` no
   * caminho de dados da ficha e sempre bug, nunca escolha.
   */
  it("o caminho de dados da ficha nao chama noStore() em runtime", () => {
    const api = stripComments(readFileSync(join(root, "src/lib/api.ts"), "utf8"))
    assert.doesNotMatch(api, /\bnoStore\s*\(\s*\)/)
    assert.doesNotMatch(api, /unstable_noStore/)
    assert.doesNotMatch(api, /PUBLIC_PROFILE_DENSITY_BYPASS_SLUGS/)
  })

  /**
   * Render degradado NAO pode virar 200 numa rota cacheada.
   *
   * `CandidatoFichaView` devolvia `DataUnavailableState` com status 200 quando o
   * recurso vinha degradado. Enquanto a rota era `force-dynamic` isso se
   * resolvia sozinho na requisicao seguinte; cacheada, aquele 200 e servido para
   * todo mundo pela hora seguinte, que e o incidente de 2026-08-02 (PR #40)
   * reaparecendo na camada de HTML.
   *
   * Rejeicao nao e cacheada, entao o caminho degradado tem que LANCAR e deixar o
   * `error.tsx` do segmento responder.
   */
  it("ficha degradada lanca em vez de renderizar 200 cacheavel", () => {
    const view = stripComments(
      readFileSync(join(root, "src/app/(site)/candidato/[slug]/CandidatoFichaView.tsx"), "utf8"),
    )
    assert.match(
      view,
      /sourceStatus\s*===\s*"degraded"\)\s*\{\s*throw new Error\(/,
      "o ramo degradado precisa lancar",
    )
    assert.doesNotMatch(
      view,
      /<DataUnavailableState/,
      "renderizar DataUnavailableState aqui devolve 200 e o 200 entra no cache",
    )
  })

  it("o segmento da ficha tem error.tsx para cobrir o throw", () => {
    const errorBoundary = readFileSync(
      join(root, "src/app/(site)/candidato/[slug]/error.tsx"),
      "utf8",
    )
    assert.match(errorBoundary, /"use client"/)
    assert.match(errorBoundary, /reset/, "precisa oferecer nova tentativa ao leitor")
  })

  it("/api/candidato-slugs remains the public full-slug inventory", () => {
    const apiRoute = readFileSync(join(root, "src/app/api/candidato-slugs/route.ts"), "utf8")
    assert.match(apiRoute, /getCandidatoSlugStaticParams/)
  })
})
