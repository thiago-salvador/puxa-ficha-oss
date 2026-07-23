import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dirPath = join(root, "src/app/(site)/quiz/r/[token]")
const routePath = join(dirPath, "route.ts")
const pagePath = join(dirPath, "page.tsx")

/**
 * Contrato /quiz/r/[token]:
 * - token inválido/ausente → HTTP 404 real (nunca 200 com "404 surface")
 * - token válido → HTTP 307 redirect para /quiz/resultado
 *
 * Regressão passada: usar notFound() em page.tsx fazia o App Router renderizar
 * a boundary de not-found com HTTP 200, cegando monitoramento externo e
 * quebrando o contrato de short-link inválido.
 */
describe("/quiz/r/[token] route contract", () => {
  it("não existe page.tsx neste segmento (contrato HTTP via route.ts)", () => {
    assert.equal(existsSync(pagePath), false, "page.tsx não pode coexistir com route.ts e quebra o contrato HTTP")
  })

  it("route.ts existe e define handler GET", () => {
    assert.equal(existsSync(routePath), true, "route.ts precisa existir")
    const src = readFileSync(routePath, "utf8")
    assert.match(src, /export\s+async\s+function\s+GET\s*\(/)
  })

  const src = existsSync(routePath) ? readFileSync(routePath, "utf8") : ""

  it("retorna HTTP 404 real quando token não resolve", () => {
    assert.match(src, /status:\s*404/, "deve emitir status 404 explícito")
    assert.doesNotMatch(src, /\bnotFound\s*\(/, "não pode depender de notFound() (boundary vira HTTP 200)")
  })

  it("retorna redirect HTTP real para token válido (não renderiza página)", () => {
    assert.match(src, /NextResponse\.redirect\s*\(/, "deve usar NextResponse.redirect")
    assert.match(src, /\/quiz\/resultado/)
  })

  it("preserva Sentry span quiz_short_link.resolve", () => {
    assert.match(src, /quiz_short_link\.resolve/)
    assert.match(src, /Sentry\.startSpan/)
  })

  it("usa resolveQuizShortToken (contrato de validação de token)", () => {
    assert.match(src, /resolveQuizShortToken/)
  })
})
