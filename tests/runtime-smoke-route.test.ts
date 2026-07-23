import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { NextRequest } from "next/server"
import { createRuntimeSmokeHandler } from "../src/app/api/internal/runtime-smoke/route"

const SECRET = "runtime-smoke-secret"
const ROUTE_URL = "https://puxaficha.com.br/api/internal/runtime-smoke"

function request(secret = SECRET) {
  return new NextRequest(ROUTE_URL, { headers: { authorization: `Bearer ${secret}` } })
}

describe("runtime smoke cron", () => {
  test("fails closed without the cron secret", async () => {
    const handler = createRuntimeSmokeHandler({
      fetchImpl: fetch,
      expectedSecret: SECRET,
      origin: "https://puxaficha.com.br",
    })
    const response = await handler(new NextRequest(ROUTE_URL))
    assert.equal(response.status, 401)
  })

  test("returns 200 only when every public canary matches", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname
      if (path === "/candidato/pf-runtime-smoke-inexistente") return new Response("", { status: 404 })
      if (path === "/api/candidato-profile/lula") {
        return new Response('{"data":{"slug":"lula"}}', { status: 200 })
      }
      return new Response(path === "/candidato/lula" ? "Lula" : "Puxa Ficha", { status: 200 })
    }
    const handler = createRuntimeSmokeHandler({ fetchImpl, expectedSecret: SECRET, origin: "https://example.test" })
    const response = await handler(request())
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true,
      total: 5,
      results: [
        { name: "home", ok: true, status: 200 },
        { name: "candidate", ok: true, status: 200 },
        { name: "profile-api", ok: true, status: 200 },
        { name: "deployment-info", ok: true, status: 200 },
        { name: "real-404", ok: true, status: 404 },
      ],
    })
  })

  test("returns 500 with bounded evidence when one canary fails", async () => {
    const handler = createRuntimeSmokeHandler({
      fetchImpl: async () => new Response("unexpected", { status: 200 }),
      expectedSecret: SECRET,
      origin: "https://example.test",
    })
    const response = await handler(request())
    assert.equal(response.status, 500)
    const body = (await response.json()) as { ok: boolean; failed: unknown[]; total: number }
    assert.equal(body.ok, false)
    assert.equal(body.total, 5)
    assert.ok(body.failed.length >= 1)
  })
})
