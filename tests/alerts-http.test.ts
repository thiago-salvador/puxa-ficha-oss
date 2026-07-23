import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, it } from "node:test"
import {
  AlertsRouteFixture,
  seedCandidate,
  seedSubscriber,
  type NotificationLogRow,
} from "./helpers/alerts-route-fixture"

const require = createRequire(import.meta.url)
const serverOnlyPath = require.resolve("server-only")
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as never

const { NextRequest } = require("next/server") as typeof import("next/server")
const { ALERT_MANAGE_TOKEN_COOKIE_NAME } = require("../src/lib/alerts-session")
const { createDeleteDataHandler } = require("../src/app/api/alerts/delete-data/route")
const { createSendDigestHandler } = require("../src/app/api/alerts/send-digest/route")
const { createSubscribeHandler } = require("../src/app/api/alerts/subscribe/route")
const { createSessionPostHandler } = require("../src/app/api/alerts/session/route")
const { createToggleHandler } = require("../src/app/api/alerts/toggle/route")
const { createUnsubscribeAllHandler } = require("../src/app/api/alerts/unsubscribe-all/route")
const { createVerifyHandler } = require("../src/app/api/alerts/verify/route")
const { rejectCrossSiteAlertsMutation } = require("../src/lib/alerts-csrf") as typeof import("../src/lib/alerts-csrf")
const alertsMeRoute = require("../src/app/api/alerts/me/route") as {
  GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>
  POST: (req: InstanceType<typeof NextRequest>) => Promise<Response>
}
const { GET: getAlertsMe, POST: postAlertsMe } = alertsMeRoute

const NOW = new Date("2026-04-10T15:00:00.000Z")
const CRON_SECRET = "cron-secret"

function createDeps(fixture: AlertsRouteFixture, now = NOW) {
  return {
    createAlertsServiceRoleClient: () => fixture.createClient(),
    findPublicCandidateBySlug: (slug: string) => fixture.findPublicCandidateBySlug(slug),
    findSubscriberByEmailHash: (emailHash: string) => fixture.findSubscriberByEmailHash(emailHash),
    findSubscriberByManageToken: (manageToken: string) => fixture.findSubscriberByManageToken(manageToken),
    findSubscriberByVerifyAndManageToken: (verifyToken: string, manageToken: string) =>
      fixture.findSubscriberByVerifyAndManageToken(verifyToken, manageToken),
    sendTransactionalEmail: (input: Parameters<AlertsRouteFixture["sendTransactionalEmail"]>[0]) =>
      fixture.sendTransactionalEmail(input),
    logAlertsApiExit: fixture.logAlertsApiExit,
    logAlertsEvent: fixture.logAlertsEvent,
    now: () => new Date(now),
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}

function assertAlertManageCookie(response: Response, expectedValue: string | undefined): void {
  const setCookie = response.headers.get("set-cookie") ?? ""
  if (expectedValue === undefined) {
    assert.doesNotMatch(setCookie, new RegExp(`${ALERT_MANAGE_TOKEN_COOKIE_NAME}=`))
    return
  }

  assert.match(setCookie, new RegExp(`${ALERT_MANAGE_TOKEN_COOKIE_NAME}=${expectedValue}`))
}

type MutativeAlertsCase = {
  name: string
  path: string
  routeLog: string
  body: Record<string, unknown>
  createFixture: () => AlertsRouteFixture
  createHandler: (fixture: AlertsRouteFixture) => (req: InstanceType<typeof NextRequest>) => Promise<Response>
  assertAllowed: (fixture: AlertsRouteFixture, response: Response) => Promise<void>
  assertBlocked: (fixture: AlertsRouteFixture) => void
}

describe("alerts HTTP routes", () => {
  const savedCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
  })

  afterEach(() => {
    if (savedCronSecret === undefined) {
      delete process.env.CRON_SECRET
      return
    }

    process.env.CRON_SECRET = savedCronSecret
  })

  describe("CSRF guard for mutative alert routes", () => {
    const manageToken = "ManageTokenCsrf001"
    const verifyToken = "VerifyTokenCsrf001"

    function mutativeCases(): MutativeAlertsCase[] {
      return [
        {
          name: "subscribe",
          path: "/api/alerts/subscribe",
          routeLog: "subscribe",
          body: { email: "eleitor@example.com", candidateSlug: "lula" },
          createFixture: () =>
            new AlertsRouteFixture({
              candidatos_publico: [seedCandidate()],
            }),
          createHandler: (fixture) => createSubscribeHandler(createDeps(fixture)),
          assertAllowed: async (fixture, response) => {
            assert.equal(response.status, 200)
            assert.equal(fixture.getTable("alert_subscribers").length, 1)
            assert.equal(fixture.getTable("alert_subscriptions").length, 1)
            assert.equal(fixture.emails.length, 1)
          },
          assertBlocked: (fixture) => {
            assert.equal(fixture.getTable("alert_subscribers").length, 0)
            assert.equal(fixture.emails.length, 0)
          },
        },
        {
          name: "verify",
          path: "/api/alerts/verify",
          routeLog: "verify",
          body: { token: verifyToken, manageToken },
          createFixture: () =>
            new AlertsRouteFixture({
              alert_subscribers: [
                seedSubscriber({
                  id: "sub_csrf_verify",
                  manageToken,
                  verifyToken,
                  verified: false,
                  verified_at: null,
                  verify_token_expires_at: "2026-04-11T14:00:00.000Z",
                }),
              ],
            }),
          createHandler: (fixture) => createVerifyHandler(createDeps(fixture)),
          assertAllowed: async (fixture, response) => {
            assert.equal(response.status, 200)
            const subscriber = fixture.getTable("alert_subscribers")[0]
            assert.equal(subscriber?.verified, true)
            assert.equal(subscriber?.verify_token_hash, null)
          },
          assertBlocked: (fixture) => {
            const subscriber = fixture.getTable("alert_subscribers")[0]
            assert.equal(subscriber?.verified, false)
            assert.notEqual(subscriber?.verify_token_hash, null)
          },
        },
        {
          name: "toggle",
          path: "/api/alerts/toggle",
          routeLog: "toggle",
          body: { manageToken, candidateSlug: "lula" },
          createFixture: () =>
            new AlertsRouteFixture({
              candidatos_publico: [seedCandidate()],
              alert_subscribers: [
                seedSubscriber({ id: "sub_csrf_toggle", manageToken, verified: true }),
              ],
            }),
          createHandler: (fixture) => createToggleHandler(createDeps(fixture)),
          assertAllowed: async (fixture, response) => {
            assert.equal(response.status, 200)
            assert.equal(fixture.getTable("alert_subscriptions").length, 1)
          },
          assertBlocked: (fixture) => {
            assert.equal(fixture.getTable("alert_subscriptions").length, 0)
          },
        },
        {
          name: "delete-data",
          path: "/api/alerts/delete-data",
          routeLog: "delete-data",
          body: { manageToken },
          createFixture: () =>
            new AlertsRouteFixture({
              alert_subscribers: [
                seedSubscriber({ id: "sub_csrf_delete", manageToken, verified: true }),
              ],
            }),
          createHandler: (fixture) => createDeleteDataHandler(createDeps(fixture)),
          assertAllowed: async (fixture, response) => {
            assert.equal(response.status, 200)
            assert.equal(fixture.getTable("alert_subscribers").length, 0)
          },
          assertBlocked: (fixture) => {
            assert.equal(fixture.getTable("alert_subscribers").length, 1)
          },
        },
        {
          name: "unsubscribe-all",
          path: "/api/alerts/unsubscribe-all",
          routeLog: "unsubscribe-all",
          body: { manageToken },
          createFixture: () => {
            const subscriber = seedSubscriber({ id: "sub_csrf_cancel", manageToken, verified: true })
            return new AlertsRouteFixture({
              alert_subscribers: [subscriber],
              alert_subscriptions: [
                { id: "asub_csrf_1", subscriber_id: subscriber.id, candidato_id: "cand_lula" },
              ],
            })
          },
          createHandler: (fixture) => createUnsubscribeAllHandler(createDeps(fixture)),
          assertAllowed: async (fixture, response) => {
            assert.equal(response.status, 200)
            assert.equal(fixture.getTable("alert_subscriptions").length, 0)
          },
          assertBlocked: (fixture) => {
            assert.equal(fixture.getTable("alert_subscriptions").length, 1)
          },
        },
        {
          name: "session",
          path: "/api/alerts/session",
          routeLog: "session",
          body: { manageToken },
          createFixture: () =>
            new AlertsRouteFixture({
              alert_subscribers: [
                seedSubscriber({ id: "sub_csrf_session", manageToken, verified: true }),
              ],
            }),
          createHandler: (fixture) => createSessionPostHandler(createDeps(fixture)),
          assertAllowed: async (_fixture, response) => {
            assert.equal(response.status, 200)
            assertAlertManageCookie(response, manageToken)
          },
          assertBlocked: (fixture) => {
            assert.equal(fixture.getTable("alert_subscribers").length, 1)
          },
        },
      ]
    }

    for (const csrfCase of mutativeCases()) {
      it(`${csrfCase.name} rejects an external Origin before the manage token can mutate`, async () => {
        const fixture = csrfCase.createFixture()
        const response = await csrfCase.createHandler(fixture)(
          fixture.request(csrfCase.path, {
            body: csrfCase.body,
            headers: { origin: "https://evil.example" },
          }),
        )

        assert.equal(response.status, 403)
        assert.deepEqual(await readJson(response), { error: "Cross-site request blocked" })
        csrfCase.assertBlocked(fixture)
        assert.deepEqual(fixture.apiExits.at(-1), {
          route: csrfCase.routeLog,
          status: 403,
          reason: "csrf_origin_not_allowed",
          detail: { origin: "https://evil.example", secFetchSite: null },
        })
      })

      it(`${csrfCase.name} rejects Sec-Fetch-Site cross-site`, async () => {
        const fixture = csrfCase.createFixture()
        const response = await csrfCase.createHandler(fixture)(
          fixture.request(csrfCase.path, {
            body: csrfCase.body,
            headers: { "sec-fetch-site": "cross-site" },
          }),
        )

        assert.equal(response.status, 403)
        csrfCase.assertBlocked(fixture)
      })

      it(`${csrfCase.name} allows same-origin browser requests`, async () => {
        const fixture = csrfCase.createFixture()
        const response = await csrfCase.createHandler(fixture)(
          fixture.request(csrfCase.path, {
            body: csrfCase.body,
            headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
          }),
        )

        await csrfCase.assertAllowed(fixture, response)
      })

      it(`${csrfCase.name} keeps non-browser internal tests valid when browser headers are absent`, async () => {
        const fixture = csrfCase.createFixture()
        const response = await csrfCase.createHandler(fixture)(
          fixture.request(csrfCase.path, {
            body: csrfCase.body,
          }),
        )

        await csrfCase.assertAllowed(fixture, response)
      })
    }

    it("alerts-csrf helper allows same-origin and blocks external origins", async () => {
      const fixture = new AlertsRouteFixture()
      const exits: Array<{
        route: string
        status: number
        reason: string
        detail?: Record<string, unknown>
      }> = []
      const logger = (
        route: string,
        status: number,
        reason: string,
        detail?: Record<string, unknown>,
      ) => exits.push({ route, status, reason, detail })

      const allowed = rejectCrossSiteAlertsMutation(
        fixture.request("/api/alerts/subscribe", {
          body: {},
          headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
        }),
        "subscribe",
        logger,
      )
      assert.equal(allowed, null)
      assert.deepEqual(exits, [])

      const blocked = rejectCrossSiteAlertsMutation(
        fixture.request("/api/alerts/subscribe", {
          body: {},
          headers: { origin: "https://evil.example" },
        }),
        "subscribe",
        logger,
      )
      assert.equal(blocked?.status, 403)
      assert.deepEqual(await readJson(blocked as Response), { error: "Cross-site request blocked" })
      assert.deepEqual(exits, [
        {
          route: "subscribe",
          status: 403,
          reason: "csrf_origin_not_allowed",
          detail: { origin: "https://evil.example", secFetchSite: null },
        },
      ])
    })
  })

  describe("POST /api/alerts/subscribe", () => {
    it("rejects invalid payload", async () => {
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
      })
      const handler = createSubscribeHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/subscribe", {
          body: {
            email: "sem-arroba",
            candidateSlug: "slug invalido",
          },
        }),
      )

      assert.equal(response.status, 400)
      assert.deepEqual(await readJson(response), { error: "Invalid payload" })
    })

    it("returns 404 when the candidate does not exist", async () => {
      const fixture = new AlertsRouteFixture()
      const handler = createSubscribeHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/subscribe", {
          body: {
            email: "eleitor@example.com",
            candidateSlug: "inexistente",
          },
        }),
      )

      assert.equal(response.status, 404)
      assert.deepEqual(await readJson(response), { error: "Candidate not found" })
    })

    it("creates a new subscriber, a pending subscription and sends the verification email", async () => {
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
      })
      const handler = createSubscribeHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/subscribe", {
          body: {
            email: "Eleitor+Teste@example.com",
            candidateSlug: "lula",
            nome: "Eleitor Teste",
          },
          headers: {
            "x-forwarded-for": "203.0.113.10",
          },
        }),
      )

      const body = await readJson<{
        ok: boolean
        requiresVerification: boolean
        emailMasked: string
        candidateSlug: string
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.requiresVerification, true)
      assert.equal(body.emailMasked, "el***********@example.com")
      assert.equal(body.candidateSlug, "lula")

      assert.equal(fixture.getTable("alert_subscribers").length, 1)
      assert.equal(fixture.getTable("alert_subscriptions").length, 1)
      assert.equal(fixture.emails.length, 1)
      assert.equal(fixture.emails[0]?.to, "eleitor+teste@example.com")
      assert.match(fixture.emails[0]?.subject ?? "", /Confirme seu alerta sobre Lula/)
      assert.equal(fixture.extractAccessUrls(0).length, 3)
      assert.ok(fixture.getTable("alert_subscribers")[0]?.last_verification_email_sent_at)
    })

    it("keeps the pending subscription during verification cooldown without sending a new email", async () => {
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [
          seedSubscriber({
            verified: false,
            last_verification_email_sent_at: "2026-04-10T14:58:00.000Z",
            verifyToken: "VerifyTokenCool001",
            manageToken: "ManageTokenCool001",
          }),
        ],
      })
      const handler = createSubscribeHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/subscribe", {
          body: {
            email: "eleitor@example.com",
            candidateSlug: "lula",
          },
          headers: {
            "x-forwarded-for": "203.0.113.10",
          },
        }),
      )

      const body = await readJson<{
        ok: boolean
        requiresVerification: boolean
        cooldownActive: boolean
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.requiresVerification, true)
      assert.equal(body.cooldownActive, true)
      assert.equal(fixture.getTable("alert_subscriptions").length, 1)
      assert.equal(fixture.emails.length, 0)
    })

    it("sends a fresh manage link for a verified subscriber without a valid browser session", async () => {
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [
          seedSubscriber({
            verified: true,
            verified_at: "2026-04-08T10:00:00.000Z",
            last_verification_email_sent_at: "2026-04-09T10:00:00.000Z",
            manageToken: "ManageTokenVerified001",
            verify_token_hash: null,
          }),
        ],
      })
      const previousManageHash = fixture.getTable("alert_subscribers")[0]?.manage_token_hash
      const handler = createSubscribeHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/subscribe", {
          body: {
            email: "eleitor@example.com",
            candidateSlug: "lula",
          },
        }),
      )

      const body = await readJson<{
        ok: boolean
        verified: boolean
        manageLinkSent: boolean
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.verified, true)
      assert.equal(body.manageLinkSent, true)
      assert.equal(fixture.emails.length, 1)
      assert.notEqual(fixture.getTable("alert_subscribers")[0]?.manage_token_hash, previousManageHash)
    })

    it("follows immediately for a verified subscriber with a valid manage token", async () => {
      const manageToken = "ManageTokenDirect001"
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [
          seedSubscriber({
            verified: true,
            verified_at: "2026-04-08T10:00:00.000Z",
            manageToken,
            verify_token_hash: null,
          }),
        ],
      })
      const handler = createSubscribeHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/subscribe", {
          body: {
            email: "eleitor@example.com",
            candidateSlug: "lula",
            manageToken,
          },
        }),
      )

      const body = await readJson<{
        ok: boolean
        verified: boolean
        following: boolean
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.verified, true)
      assert.equal(body.following, true)
      assert.equal(fixture.getTable("alert_subscriptions").length, 1)
      assertAlertManageCookie(response, manageToken)
    })

    it("returns 503 when sending the verification email fails", async () => {
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
      })
      fixture.failNextEmail("transport down")
      const handler = createSubscribeHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/subscribe", {
          body: {
            email: "eleitor@example.com",
            candidateSlug: "lula",
          },
        }),
      )

      assert.equal(response.status, 503)
      assert.deepEqual(await readJson(response), {
        error: "Não foi possível enviar o e-mail de confirmação agora.",
      })
      assert.equal(fixture.getTable("alert_subscribers").length, 1)
      assert.equal(fixture.getTable("alert_subscriptions").length, 1)
      assert.equal(fixture.emails.length, 0)
    })
  })

  describe("POST /api/alerts/verify", () => {
    it("rejects invalid payload", async () => {
      const fixture = new AlertsRouteFixture()
      const handler = createVerifyHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/verify", {
          body: {
            token: "",
            manageToken: "",
          },
        }),
      )

      assert.equal(response.status, 400)
      assert.deepEqual(await readJson(response), { error: "Invalid payload" })
    })

    it("returns 410 when the verification link expired", async () => {
      const manageToken = "ManageTokenVerify001"
      const verifyToken = "VerifyTokenVerify001"
      const fixture = new AlertsRouteFixture({
        alert_subscribers: [
          seedSubscriber({
            manageToken,
            verifyToken,
            verify_token_expires_at: "2026-04-09T14:00:00.000Z",
          }),
        ],
      })
      const handler = createVerifyHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/verify", {
          body: {
            token: verifyToken,
            manageToken,
          },
        }),
      )

      assert.equal(response.status, 410)
      assert.deepEqual(await readJson(response), {
        error: "Invalid or expired verification link",
      })
      assert.match(
        response.headers.get("cache-control") ?? "",
        /no-store/i,
      )
    })

    it("returns a generic 410 (no cookie) when verify mismatches but the manage token was already verified", async () => {
      const manageToken = "ManageTokenVerified002"
      const fixture = new AlertsRouteFixture({
        alert_subscribers: [
          seedSubscriber({
            manageToken,
            verified: true,
            verified_at: "2026-04-08T10:00:00.000Z",
            verify_token_hash: null,
          }),
        ],
      })
      const handler = createVerifyHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/verify", {
          body: {
            token: "VerifyTokenUnused002",
            manageToken,
          },
        }),
      )

      assert.equal(response.status, 410)
      assert.deepEqual(await readJson(response), {
        error: "Invalid or expired verification link",
      })
      // Uniformização: a resposta não pode sinalizar que o manage token era válido —
      // logo, nenhum cookie de sessão é setado neste caminho.
      assertAlertManageCookie(response, undefined)
    })

    it("returns a generic 410 for an unknown verify/manage pair (no cookie)", async () => {
      const fixture = new AlertsRouteFixture()
      const handler = createVerifyHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/verify", {
          body: {
            token: "VerifyTokenRandom999",
            manageToken: "ManageTokenRandom999",
          },
        }),
      )

      assert.equal(response.status, 410)
      assert.deepEqual(await readJson(response), {
        error: "Invalid or expired verification link",
      })
      assertAlertManageCookie(response, undefined)
    })

    it("marks the subscriber as verified and stores the browser cookie", async () => {
      const manageToken = "ManageTokenVerify002"
      const verifyToken = "VerifyTokenVerify002"
      const fixture = new AlertsRouteFixture({
        alert_subscribers: [
          seedSubscriber({
            manageToken,
            verifyToken,
            verified: false,
            verified_at: null,
            verify_token_expires_at: "2026-04-11T14:00:00.000Z",
          }),
        ],
      })
      const handler = createVerifyHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/verify", {
          body: {
            token: verifyToken,
            manageToken,
          },
        }),
      )

      const body = await readJson<{ ok: boolean; verified: boolean }>(response)
      const subscriber = fixture.getTable("alert_subscribers")[0]

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.verified, true)
      assert.equal(subscriber?.verified, true)
      assert.equal(subscriber?.verify_token_hash, null)
      assert.equal(subscriber?.verify_token_expires_at, null)
      assertAlertManageCookie(response, manageToken)
    })
  })

  describe("POST /api/alerts/toggle", () => {
    it("rejects an invalid manage token", async () => {
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
      })
      const handler = createToggleHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/toggle", {
          body: {
            manageToken: "ManageTokenUnknown001",
            candidateSlug: "lula",
          },
        }),
      )

      assert.equal(response.status, 403)
      assert.deepEqual(await readJson(response), { error: "Invalid manage token" })
    })

    it("blocks follow changes while the email is not verified", async () => {
      const manageToken = "ManageTokenUnverified001"
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [seedSubscriber({ manageToken, verified: false })],
      })
      const handler = createToggleHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/toggle", {
          body: {
            manageToken,
            candidateSlug: "lula",
          },
        }),
      )

      assert.equal(response.status, 409)
      assert.deepEqual(await readJson(response), { error: "Email verification required" })
    })

    it("creates a subscription when following a candidate", async () => {
      const manageToken = "ManageTokenToggle001"
      const subscriber = seedSubscriber({ id: "sub_toggle_1", manageToken, verified: true })
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [subscriber],
      })
      const handler = createToggleHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/toggle", {
          body: {
            manageToken,
            candidateSlug: "lula",
          },
        }),
      )

      assert.equal(response.status, 200)
      assert.deepEqual(await readJson(response), {
        ok: true,
        following: true,
        candidateSlug: "lula",
      })
      assert.equal(fixture.getTable("alert_subscriptions").length, 1)
    })

    it("removes an existing subscription when unfollowing", async () => {
      const manageToken = "ManageTokenToggle002"
      const subscriber = seedSubscriber({ id: "sub_toggle_2", manageToken, verified: true })
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [subscriber],
        alert_subscriptions: [
          {
            id: "asub_1",
            subscriber_id: subscriber.id,
            candidato_id: "cand_lula",
          },
        ],
      })
      const handler = createToggleHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/toggle", {
          body: {
            manageToken,
            candidateSlug: "lula",
          },
        }),
      )

      assert.equal(response.status, 200)
      assert.deepEqual(await readJson(response), {
        ok: true,
        following: false,
        candidateSlug: "lula",
      })
      assert.equal(fixture.getTable("alert_subscriptions").length, 0)
    })
  })

  describe("POST /api/alerts/delete-data", () => {
    it("rejects an invalid manage token", async () => {
      const fixture = new AlertsRouteFixture()
      const handler = createDeleteDataHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/delete-data", {
          body: {
            manageToken: "ManageTokenMissing001",
          },
        }),
      )

      assert.equal(response.status, 403)
      assert.deepEqual(await readJson(response), { error: "Invalid manage token" })
    })

    it("deletes subscriber data and clears the browser cookie", async () => {
      const manageToken = "ManageTokenDelete001"
      const subscriber = seedSubscriber({ id: "sub_delete_1", manageToken, verified: true })
      const fixture = new AlertsRouteFixture({
        alert_subscribers: [subscriber],
        alert_subscriptions: [
          { id: "asub_1", subscriber_id: subscriber.id, candidato_id: "cand_lula" },
        ],
        notification_log: [
          {
            id: "nlog_1",
            subscriber_id: subscriber.id,
            canal: "email",
            digest_date: "2026-04-10",
            status: "sent",
            error_message: null,
          },
        ],
      })
      const handler = createDeleteDataHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/delete-data", {
          body: {
            manageToken,
          },
        }),
      )

      assert.equal(response.status, 200)
      assert.deepEqual(await readJson(response), { ok: true })
      assert.equal(fixture.getTable("alert_subscribers").length, 0)
      assert.equal(fixture.getTable("alert_subscriptions").length, 0)
      assert.equal(fixture.getTable("notification_log").length, 0)
      assertAlertManageCookie(response, "")
    })
  })

  describe("POST /api/alerts/unsubscribe-all", () => {
    it("rejects an invalid manage token", async () => {
      const fixture = new AlertsRouteFixture()
      const handler = createUnsubscribeAllHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/unsubscribe-all", {
          body: {
            manageToken: "ManageTokenMissing002",
          },
        }),
      )

      assert.equal(response.status, 403)
      assert.deepEqual(await readJson(response), { error: "Invalid manage token" })
    })

    it("removes all subscriptions for the subscriber", async () => {
      const manageToken = "ManageTokenCancel001"
      const subscriber = seedSubscriber({ id: "sub_cancel_1", manageToken, verified: true })
      const fixture = new AlertsRouteFixture({
        alert_subscribers: [subscriber],
        alert_subscriptions: [
          { id: "asub_1", subscriber_id: subscriber.id, candidato_id: "cand_lula" },
          { id: "asub_2", subscriber_id: subscriber.id, candidato_id: "cand_haddad" },
        ],
      })
      const handler = createUnsubscribeAllHandler(createDeps(fixture))

      const response = await handler(
        fixture.request("/api/alerts/unsubscribe-all", {
          body: {
            manageToken,
          },
        }),
      )

      assert.equal(response.status, 200)
      assert.deepEqual(await readJson(response), { ok: true })
      assert.equal(fixture.getTable("alert_subscriptions").length, 0)
    })
  })

  describe("POST /api/alerts/send-digest", () => {
    function buildDigestRequest(
      fixture: AlertsRouteFixture,
      query = "",
      auth = `Bearer ${CRON_SECRET}`,
    ) {
      return fixture.request(`/api/alerts/send-digest${query}`, {
        headers: auth ? { authorization: auth } : {},
      })
    }

    function baseDigestFixture() {
      const subscriber = seedSubscriber({
        id: "sub_digest_1",
        email: "digest@example.com",
        manageToken: "ManageTokenDigest001",
        verifyToken: "VerifyTokenDigest001",
        verified: true,
        verified_at: "2026-04-09T10:00:00.000Z",
        verify_token_hash: null,
      })

      return new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [subscriber],
        alert_subscriptions: [
          { id: "asub_1", subscriber_id: subscriber.id, candidato_id: "cand_lula" },
        ],
      })
    }

    it("rejects requests without the cron secret", async () => {
      const fixture = new AlertsRouteFixture()
      const handler = createSendDigestHandler(createDeps(fixture))

      const response = await handler(buildDigestRequest(fixture, "", ""))

      assert.equal(response.status, 401)
      assert.deepEqual(await readJson(response), { error: "Unauthorized" })
    })

    it("returns an empty successful batch when there are no subscribers", async () => {
      const fixture = new AlertsRouteFixture()
      const handler = createSendDigestHandler(createDeps(fixture))

      const response = await handler(buildDigestRequest(fixture))

      assert.equal(response.status, 200)
      assert.deepEqual(await readJson(response), {
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        cursor: 0,
        nextCursor: null,
        chainScheduled: false,
        chainDepth: 0,
        total: 0,
      })
    })

    it("skips verified subscribers that have no relevant changes in the current window", async () => {
      const fixture = baseDigestFixture()
      const handler = createSendDigestHandler(createDeps(fixture))

      const response = await handler(buildDigestRequest(fixture))

      const body = await readJson<{
        ok: boolean
        sent: number
        skipped: number
        failed: number
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.sent, 0)
      assert.equal(body.skipped, 1)
      assert.equal(body.failed, 0)
      assert.equal(fixture.emails.length, 0)
      assert.equal(fixture.getTable("notification_log").length, 0)
    })

    it("sends the digest, records notification_log and updates last_digest_sent_at", async () => {
      const fixture = baseDigestFixture()
      fixture.setTable("candidate_changes", [
        {
          id: "chg_1",
          candidato_id: "cand_lula",
          titulo: "Nova atualização editorial",
          descricao: "Texto curto da mudança.",
          created_at: "2026-04-10T12:00:00.000Z",
        },
      ])

      const handler = createSendDigestHandler(createDeps(fixture))
      const response = await handler(buildDigestRequest(fixture))
      const body = await readJson<{
        ok: boolean
        sent: number
        failed: number
        skipped: number
      }>(response)
      const logRow = fixture.getTable("notification_log")[0]
      const subscriber = fixture.getTable("alert_subscribers")[0]

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.sent, 1)
      assert.equal(body.failed, 0)
      assert.equal(body.skipped, 0)
      assert.equal(fixture.emails.length, 1)
      assert.match(fixture.emails[0]?.subject ?? "", /Lula/)
      assert.equal(fixture.emails[0]?.headers?.["List-Unsubscribe"], "<https://puxaficha.com.br/alertas/acesso?manage=ManageTokenDigest001&hash=cancelar-tudo>")
      assert.equal(logRow?.status, "sent")
      assert.equal(logRow?.sent_at, NOW.toISOString())
      assert.equal(subscriber?.last_digest_sent_at, NOW.toISOString())
    })

    it("marks notification_log as failed when the email provider throws", async () => {
      const fixture = baseDigestFixture()
      fixture.setTable("candidate_changes", [
        {
          id: "chg_1",
          candidato_id: "cand_lula",
          titulo: "Nova atualização editorial",
          descricao: "Texto curto da mudança.",
          created_at: "2026-04-10T12:00:00.000Z",
        },
      ])
      fixture.failNextEmail("resend down")

      const handler = createSendDigestHandler(createDeps(fixture))
      const response = await handler(buildDigestRequest(fixture))
      const body = await readJson<{
        ok: boolean
        sent: number
        failed: number
      }>(response)
      const logRow = fixture.getTable("notification_log")[0]

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.sent, 0)
      assert.equal(body.failed, 1)
      assert.equal(logRow?.status, "failed")
      assert.equal(logRow?.error_message, "resend down")
    })

    it("does not count the digest as sent when notification_log sent update fails", async () => {
      const fixture = baseDigestFixture()
      fixture.setTable("candidate_changes", [
        {
          id: "chg_1",
          candidato_id: "cand_lula",
          titulo: "Nova atualização editorial",
          descricao: "Texto curto da mudança.",
          created_at: "2026-04-10T12:00:00.000Z",
        },
      ])
      fixture.failNextUpdate("notification_log", "notification log unavailable")

      const handler = createSendDigestHandler(createDeps(fixture))
      const response = await handler(buildDigestRequest(fixture))
      const body = await readJson<{
        ok: boolean
        sent: number
        failed: number
      }>(response)
      const logRow = fixture.getTable("notification_log")[0]

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.sent, 0)
      assert.equal(body.failed, 1)
      assert.equal(fixture.emails.length, 1)
      assert.equal(logRow?.status, "failed")
      assert.equal(logRow?.error_message, "notification_log_sent_update: notification log unavailable")
    })

    it("surfaces failure when last_digest_sent_at update fails after email delivery", async () => {
      const fixture = baseDigestFixture()
      fixture.setTable("candidate_changes", [
        {
          id: "chg_1",
          candidato_id: "cand_lula",
          titulo: "Nova atualização editorial",
          descricao: "Texto curto da mudança.",
          created_at: "2026-04-10T12:00:00.000Z",
        },
      ])
      fixture.failNextUpdate("alert_subscribers", "subscriber digest timestamp unavailable")

      const handler = createSendDigestHandler(createDeps(fixture))
      const response = await handler(buildDigestRequest(fixture))
      const body = await readJson<{
        ok: boolean
        sent: number
        failed: number
      }>(response)
      const logRow = fixture.getTable("notification_log")[0]
      const subscriber = fixture.getTable("alert_subscribers")[0]

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.sent, 0)
      assert.equal(body.failed, 1)
      assert.equal(fixture.emails.length, 1)
      assert.equal(logRow?.status, "sent")
      assert.equal(logRow?.error_message, "alert_subscriber_digest_update: subscriber digest timestamp unavailable")
      assert.equal(subscriber?.last_digest_sent_at, null)
      assert.ok(fixture.events.some((event) => event.detail?.step === "alert_subscriber_digest_update"))
    })

    it("is idempotent when a sent notification_log already exists for the same digest date", async () => {
      const fixture = baseDigestFixture()
      fixture.setTable("candidate_changes", [
        {
          id: "chg_1",
          candidato_id: "cand_lula",
          titulo: "Nova atualização editorial",
          descricao: "Texto curto da mudança.",
          created_at: "2026-04-10T12:00:00.000Z",
        },
      ])
      fixture.setTable("notification_log", [
        {
          id: "nlog_sent_1",
          subscriber_id: "sub_digest_1",
          canal: "email",
          digest_date: "2026-04-10",
          status: "sent",
          error_message: null,
          sent_at: "2026-04-10T13:00:00.000Z",
        } satisfies NotificationLogRow,
      ])

      const handler = createSendDigestHandler(createDeps(fixture))
      const response = await handler(buildDigestRequest(fixture))
      const body = await readJson<{
        ok: boolean
        sent: number
        skipped: number
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.sent, 0)
      assert.equal(body.skipped, 1)
      assert.equal(fixture.emails.length, 0)
    })

    it("chains the next batch when there are more verified subscribers to process", async () => {
      const subscriberOne = seedSubscriber({
        id: "sub_digest_chain_1",
        email: "primeiro@example.com",
        manageToken: "ManageTokenChain001",
        verified: true,
        verified_at: "2026-04-09T10:00:00.000Z",
        verify_token_hash: null,
      })
      const subscriberTwo = seedSubscriber({
        id: "sub_digest_chain_2",
        email: "segundo@example.com",
        manageToken: "ManageTokenChain002",
        verified: true,
        verified_at: "2026-04-09T10:00:00.000Z",
        verify_token_hash: null,
      })
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [subscriberOne, subscriberTwo],
        alert_subscriptions: [
          { id: "asub_1", subscriber_id: subscriberOne.id, candidato_id: "cand_lula" },
          { id: "asub_2", subscriber_id: subscriberTwo.id, candidato_id: "cand_lula" },
        ],
        candidate_changes: [
          {
            id: "chg_1",
            candidato_id: "cand_lula",
            titulo: "Nova atualização editorial",
            descricao: "Texto curto da mudança.",
            created_at: "2026-04-10T12:00:00.000Z",
          },
        ],
      })
      const chainedRequests: Array<{ url: string; authorization: string | null }> = []
      const afterCallbacks: Array<() => Promise<void> | void> = []
      const handler = createSendDigestHandler({
        ...createDeps(fixture),
        afterResponse: (callback: () => Promise<void> | void) => {
          afterCallbacks.push(callback)
        },
        fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
          chainedRequests.push({
            url: String(input),
            authorization: init?.headers instanceof Headers
              ? init.headers.get("authorization")
              : (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
          })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        },
      })

      const response = await handler(buildDigestRequest(fixture, "?limit=1"))
      const body = await readJson<{
        ok: boolean
        processed: number
        nextCursor: number | null
        chainScheduled: boolean
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.ok, true)
      assert.equal(body.processed, 1)
      assert.equal(body.nextCursor, 1)
      assert.equal(body.chainScheduled, true)
      assert.equal(afterCallbacks.length, 1)

      await afterCallbacks[0]?.()

      assert.equal(chainedRequests.length, 1)
      assert.match(chainedRequests[0]?.url ?? "", /cursor=1/)
      assert.match(chainedRequests[0]?.url ?? "", /limit=1/)
      assert.match(chainedRequests[0]?.url ?? "", /depth=1/)
      assert.equal(chainedRequests[0]?.authorization, `Bearer ${CRON_SECRET}`)
    })

    it("does not chain past the configured digest depth ceiling", async () => {
      const subscriberOne = seedSubscriber({
        id: "sub_digest_depth_1",
        email: "primeiro-depth@example.com",
        manageToken: "ManageTokenDepth001",
        verified: true,
        verified_at: "2026-04-09T10:00:00.000Z",
        verify_token_hash: null,
      })
      const subscriberTwo = seedSubscriber({
        id: "sub_digest_depth_2",
        email: "segundo-depth@example.com",
        manageToken: "ManageTokenDepth002",
        verified: true,
        verified_at: "2026-04-09T10:00:00.000Z",
        verify_token_hash: null,
      })
      const fixture = new AlertsRouteFixture({
        candidatos_publico: [seedCandidate()],
        alert_subscribers: [subscriberOne, subscriberTwo],
        alert_subscriptions: [
          { id: "asub_depth_1", subscriber_id: subscriberOne.id, candidato_id: "cand_lula" },
          { id: "asub_depth_2", subscriber_id: subscriberTwo.id, candidato_id: "cand_lula" },
        ],
        candidate_changes: [
          {
            id: "chg_depth_1",
            candidato_id: "cand_lula",
            titulo: "Nova atualização editorial",
            descricao: "Texto curto da mudança.",
            created_at: "2026-04-10T12:00:00.000Z",
          },
        ],
      })
      const afterCallbacks: Array<() => Promise<void> | void> = []
      const handler = createSendDigestHandler({
        ...createDeps(fixture),
        afterResponse: (callback: () => Promise<void> | void) => {
          afterCallbacks.push(callback)
        },
      })

      const response = await handler(buildDigestRequest(fixture, "?limit=1&depth=20"))
      const body = await readJson<{
        nextCursor: number | null
        chainScheduled: boolean
        chainDepth: number
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.nextCursor, 1)
      assert.equal(body.chainScheduled, false)
      assert.equal(body.chainDepth, 20)
      assert.equal(afterCallbacks.length, 0)
    })
  })

  describe("GET /api/alerts/me", () => {
    it("sets private no-store cache headers on the anonymous response", async () => {
      const request = new NextRequest("http://localhost/api/alerts/me", {
        method: "GET",
      })
      const response = await getAlertsMe(request)

      const cacheControl = response.headers.get("cache-control") ?? ""
      assert.match(cacheControl, /no-store/i)
      assert.match(cacheControl, /private/i)
      assert.match(cacheControl, /must-revalidate/i)
      assert.equal(response.headers.get("pragma"), "no-cache")

      const body = (await response.json()) as {
        ok: boolean
        anonymous: boolean
      }
      assert.equal(body.ok, false)
      assert.equal(body.anonymous, true)
    })

    it("sets private no-store cache headers on POST error responses", async () => {
      const request = new NextRequest("http://localhost/api/alerts/me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      })
      const response = await postAlertsMe(request)

      assert.equal(response.status, 400)
      const cacheControl = response.headers.get("cache-control") ?? ""
      assert.match(cacheControl, /no-store/i)
      assert.match(cacheControl, /private/i)
      assert.match(cacheControl, /must-revalidate/i)
    })

    it("rejects oversized POST bodies before JSON parse", async () => {
      const request = new NextRequest("http://localhost/api/alerts/me", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "203.0.113.201",
        },
        body: JSON.stringify({ manageToken: "x".repeat(20_000) }),
      })
      const response = await postAlertsMe(request)

      assert.equal(response.status, 413)
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i)
    })

    it("rate-limits alerts/me anonymous reads", async () => {
      const headers = { "x-real-ip": "203.0.113.202" }
      let response: Response | null = null

      for (let index = 0; index < 121; index += 1) {
        response = await getAlertsMe(
          new NextRequest("http://localhost/api/alerts/me", {
            method: "GET",
            headers,
          }),
        )
      }

      assert.equal(response?.status, 429)
      assert.match(response?.headers.get("cache-control") ?? "", /no-store/i)
    })
  })
})
