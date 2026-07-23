import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { puxaFichaNextConfig } from "../next.config"

type HeaderRule = {
  source: string
  headers: Array<{ key: string; value: string }>
  has?: Array<{ key: string }>
  missing?: Array<{ key: string }>
}

type RedirectRule = {
  source: string
  destination: string
  permanent: boolean
  has?: Array<{ type: string; value: string }>
}

function headerValue(rule: HeaderRule, key: string): string | null {
  return rule.headers.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value ?? null
}

describe("next security headers", () => {
  it("permite 127.0.0.1 no next dev para o browser harness local", () => {
    assert.deepEqual(puxaFichaNextConfig.allowedDevOrigins, ["127.0.0.1"])
  })

  it("aplica headers de iframe por path no embed e deixa CSP dinamico para o middleware", async () => {
    assert.ok(puxaFichaNextConfig.headers)
    const rules = (await puxaFichaNextConfig.headers()) as HeaderRule[]
    const embedRule = rules.find((rule) => rule.source === "/embed/:path*")
    const globalRule = rules.find((rule) => rule.source === "/((?!embed/|embed$).*)")

    assert.ok(embedRule)
    assert.ok(globalRule)

    assert.equal(headerValue(embedRule, "Content-Security-Policy"), null)
    assert.equal(headerValue(embedRule, "X-Frame-Options"), null)
    assert.equal(headerValue(embedRule, "X-Robots-Tag"), "noindex, nofollow")

    assert.equal(headerValue(globalRule, "Content-Security-Policy"), null)
    assert.equal(headerValue(globalRule, "X-Frame-Options"), "DENY")

    assert.equal(
      rules.some((rule) =>
        [...(rule.has ?? []), ...(rule.missing ?? [])].some((cond) => cond.key === "x-pf-embed-card")
      ),
      false
    )
  })
})

describe("next domain redirects", () => {
  it("canoniza www para apex sem depender de canonical ambíguo", async () => {
    assert.ok(puxaFichaNextConfig.redirects)
    const redirects = (await puxaFichaNextConfig.redirects()) as RedirectRule[]
    const wwwRedirect = redirects.find((rule) =>
      rule.has?.some((condition) => condition.type === "host" && condition.value === "www.puxaficha.com.br")
    )

    assert.ok(wwwRedirect)
    assert.equal(wwwRedirect.source, "/:path*")
    assert.equal(wwwRedirect.destination, "https://puxaficha.com.br/:path*")
    assert.equal(wwwRedirect.permanent, true)
  })
})
