import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { NextRequest } from "next/server"
import { middleware } from "../middleware"

const env = process.env as Record<string, string | undefined>
const savedEnv: Partial<Record<string, string | undefined>> = {}
let savedFetch: typeof globalThis.fetch

function request(url: string, cookie?: string) {
  return new NextRequest(url, {
    headers: cookie ? { cookie } : undefined,
  })
}

function slugListResponse(slugs: unknown, init?: ResponseInit) {
  return Response.json({ slugs }, init)
}

describe("middleware route protection", () => {
  beforeEach(() => {
    savedFetch = globalThis.fetch
    savedEnv.NODE_ENV = env.NODE_ENV
    savedEnv.VERCEL = env.VERCEL
    savedEnv.VERCEL_ENV = env.VERCEL_ENV
    savedEnv.PF_PREVIEW_TOKEN = env.PF_PREVIEW_TOKEN
    savedEnv.PF_INTERNAL_TOKEN = env.PF_INTERNAL_TOKEN
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
    globalThis.fetch = savedFetch
  })

  it("returns 404 for preview routes without a token", async () => {
    env.NODE_ENV = "production"
    env.VERCEL_ENV = "production"
    env.PF_PREVIEW_TOKEN = "preview-secret-token-123456"

    const response = await middleware(request("http://localhost/preview/candidato/lula"))

    assert.equal(response.status, 404)
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8")
  })

  it("bootstraps preview access from query token, strips the query and sets the preview cookie", async () => {
    env.NODE_ENV = "production"
    env.VERCEL_ENV = "production"
    env.PF_PREVIEW_TOKEN = "preview-secret-token-123456"

    const response = await middleware(
      request("http://localhost/preview/candidato/lula?token=preview-secret-token-123456"),
    )

    assert.equal(response.status, 307)
    assert.equal(response.headers.get("location"), "http://localhost/preview/candidato/lula")
    assert.match(response.headers.get("set-cookie") ?? "", /pf_preview_token=preview-secret-token-123456/)
    assert.match(response.headers.get("set-cookie") ?? "", /Path=\/preview/)
  })

  it("allows preview routes with a valid preview cookie", async () => {
    env.NODE_ENV = "production"
    env.VERCEL_ENV = "production"
    env.PF_PREVIEW_TOKEN = "preview-secret-token-123456"

    const response = await middleware(
      request(
        "http://localhost/preview/candidato/lula",
        "pf_preview_token=preview-secret-token-123456",
      ),
    )

    assert.equal(response.headers.get("x-middleware-next"), "1")
  })

  it("fails closed in Vercel production when the preview token is missing or too short", async () => {
    env.NODE_ENV = "production"
    env.VERCEL_ENV = "production"
    env.PF_PREVIEW_TOKEN = "short-token"

    const response = await middleware(
      request("http://localhost/preview/candidato/lula?token=short-token"),
    )

    assert.equal(response.status, 404)
  })

  it("fails closed on Vercel PREVIEW deployments when the token is missing or too short", async () => {
    // Regressão 2026-06-09: o fallback hardcoded "local-preview" valia em qualquer
    // env != production, então preview deployments expunham fichas não publicadas.
    env.NODE_ENV = "production"
    env.VERCEL = "1"
    env.VERCEL_ENV = "preview"
    delete env.PF_PREVIEW_TOKEN

    const missing = await middleware(request("http://localhost/preview/candidato/lula"))
    assert.equal(missing.status, 404)

    env.PF_PREVIEW_TOKEN = "short-token"
    const weak = await middleware(
      request("http://localhost/preview/candidato/lula?token=short-token"),
    )
    assert.equal(weak.status, 404)
  })

  it("fails closed on any deployed Vercel env (VERCEL=1) even with VERCEL_ENV unset", async () => {
    // Ancorar em VERCEL==="1" garante fail-closed mesmo se VERCEL_ENV não vier.
    env.NODE_ENV = "production"
    env.VERCEL = "1"
    delete env.VERCEL_ENV
    delete env.PF_PREVIEW_TOKEN

    const missing = await middleware(request("http://localhost/preview/candidato/lula"))
    assert.equal(missing.status, 404)

    env.PF_PREVIEW_TOKEN = "preview-secret-token-123456"
    const bootstrap = await middleware(
      request("http://localhost/preview/candidato/lula?token=preview-secret-token-123456"),
    )
    assert.equal(bootstrap.status, 307)
    assert.match(bootstrap.headers.get("set-cookie") ?? "", /pf_preview_token=preview-secret-token-123456/)
  })

  it("applies the same token bootstrap flow to internaltest and styleguide routes", async () => {
    env.NODE_ENV = "production"
    delete env.VERCEL_ENV
    env.PF_INTERNAL_TOKEN = "internal-secret-token"

    const denied = await middleware(request("http://localhost/internaltest"))
    assert.equal(denied.status, 404)

    const bootstrap = await middleware(
      request("http://localhost/internaltest?token=internal-secret-token"),
    )
    assert.equal(bootstrap.status, 307)
    assert.equal(bootstrap.headers.get("location"), "http://localhost/internaltest")
    assert.match(bootstrap.headers.get("set-cookie") ?? "", /pf_internal_token=internal-secret-token/)
    assert.match(bootstrap.headers.get("set-cookie") ?? "", /Path=\//)

    const viaCookie = await middleware(
      request("http://localhost/styleguide", "pf_internal_token=internal-secret-token"),
    )
    assert.equal(viaCookie.headers.get("x-middleware-next"), "1")
  })

  it("fails closed in Vercel production when the internal token is missing or too short", async () => {
    env.NODE_ENV = "production"
    env.VERCEL_ENV = "production"
    delete env.PF_INTERNAL_TOKEN

    const missing = await middleware(request("http://localhost/internaltest"))
    assert.equal(missing.status, 404)

    env.PF_INTERNAL_TOKEN = "short-token"
    const weak = await middleware(request("http://localhost/internaltest?token=short-token"))
    assert.equal(weak.status, 404)
  })

  it("returns 404 for malformed candidato slugs without querying the slug list", async () => {
    let called = false
    globalThis.fetch = async () => {
      called = true
      throw new Error("slug list should not be fetched for malformed slugs")
    }

    const response = await middleware(request("http://localhost/candidato/slug%20invalido"))

    assert.equal(called, false)
    assert.equal(response.status, 404)
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  })

  it("allows valid candidato slugs returned by the internal slug list", async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/api/candidato-slugs")
      assert.equal((init?.headers as Record<string, string>)["x-middleware-internal"], "candidato-slugs")
      return slugListResponse(["lula"])
    }

    const response = await middleware(request("http://localhost/candidato/lula"))

    assert.equal(response.headers.get("x-middleware-next"), "1")
  })

  it("returns 404 for unknown candidato slugs when the slug list is available", async () => {
    globalThis.fetch = async () => slugListResponse(["lula"])

    const response = await middleware(request("http://localhost/candidato/slug-desconhecido"))

    assert.equal(response.status, 404)
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  })

  it("keeps candidato routes fail-open only when the internal slug list is unavailable", async () => {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 })

    const response = await middleware(request("http://localhost/candidato/slug-qualquer"))

    assert.equal(response.headers.get("x-middleware-next"), "1")
  })

  it("keeps embed routes public and frameable", async () => {
    const response = await middleware(request("http://localhost/embed/lula"))

    assert.equal(response.headers.get("x-middleware-next"), "1")
    assert.match(response.headers.get("Content-Security-Policy") ?? "", /frame-ancestors \*/)
  })
})
