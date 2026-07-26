/**
 * Anti-enumeracao no /api/alerts/subscribe (endurecimento de 2026-07-26).
 *
 * O endpoint respondia com corpos diferentes conforme o estado do email:
 * `manageLinkSent` para verificado, `requiresVerification` para cadastrado sem
 * verificar, e `cooldownActive` quando o envio tinha sido recente. Bastava
 * enviar um endereco para descobrir se ele estava na base e em que estagio.
 * Num site sobre politica, saber quem acompanha qual candidato nao e dano
 * hipotetico.
 *
 * Este teste trava a propriedade: os tres caminhos de sucesso respondem
 * exatamente o mesmo corpo. Os efeitos colaterais (linhas gravadas, email
 * disparado) continuam diferentes, e e isso que se quer: o comportamento muda,
 * a resposta observavel nao.
 */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { describe, it } from "node:test"
import {
  AlertsRouteFixture,
  seedCandidate,
  seedSubscriber,
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
const subscribeRoute = require("../src/app/api/alerts/subscribe/route")
const { createSubscribeHandler } = subscribeRoute

const NOW = new Date("2026-04-10T15:00:00.000Z")

function createDeps(fixture: AlertsRouteFixture) {
  return {
    createAlertsServiceRoleClient: () => fixture.createClient(),
    findPublicCandidateBySlug: (slug: string) => fixture.findPublicCandidateBySlug(slug),
    findSubscriberByEmailHash: (emailHash: string) => fixture.findSubscriberByEmailHash(emailHash),
    findSubscriberByManageToken: (manageToken: string) =>
      fixture.findSubscriberByManageToken(manageToken),
    findSubscriberByVerifyAndManageToken: (verifyToken: string, manageToken: string) =>
      fixture.findSubscriberByVerifyAndManageToken(verifyToken, manageToken),
    sendTransactionalEmail: (input: Parameters<AlertsRouteFixture["sendTransactionalEmail"]>[0]) =>
      fixture.sendTransactionalEmail(input),
    logAlertsApiExit: fixture.logAlertsApiExit,
    logAlertsEvent: fixture.logAlertsEvent,
    now: () => new Date(NOW),
  }
}

function subscribeRequest(email: string, ip: string) {
  return new NextRequest("http://localhost/api/alerts/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "x-vercel-forwarded-for": ip,
      "x-real-ip": ip,
    },
    body: JSON.stringify({ email, candidateSlug: "lula" }),
  })
}

/** Cada cenario usa um IP proprio para nao esbarrar no teto por janela. */
async function subscribeBody(fixture: AlertsRouteFixture, email: string, ip: string) {
  const response = await createSubscribeHandler(createDeps(fixture))(subscribeRequest(email, ip))
  assert.equal(response.status, 200, "os tres caminhos respondem 200")
  return (await response.json()) as Record<string, unknown>
}

describe("alerts subscribe: resposta neutra contra enumeracao", () => {
  it("responde identico para email novo, cadastrado sem verificar e ja verificado", async () => {
    const novo = new AlertsRouteFixture({ candidatos_publico: [seedCandidate()] })
    const corpoNovo = await subscribeBody(novo, "novo@example.com", "203.0.113.1")

    const naoVerificado = new AlertsRouteFixture({
      candidatos_publico: [seedCandidate()],
      alert_subscribers: [seedSubscriber({ email: "pendente@example.com", verified: false })],
    })
    const corpoNaoVerificado = await subscribeBody(
      naoVerificado,
      "pendente@example.com",
      "203.0.113.2",
    )

    const verificado = new AlertsRouteFixture({
      candidatos_publico: [seedCandidate()],
      alert_subscribers: [
        seedSubscriber({
          email: "verificado@example.com",
          verified: true,
          verified_at: "2026-04-01T10:00:00.000Z",
          verify_token_hash: null,
        }),
      ],
    })
    const corpoVerificado = await subscribeBody(
      verificado,
      "verificado@example.com",
      "203.0.113.3",
    )

    assert.deepEqual(
      corpoNovo,
      corpoNaoVerificado,
      "email novo e email pendente nao podem ser distinguiveis pela resposta",
    )
    assert.deepEqual(
      corpoNovo,
      corpoVerificado,
      "email verificado nao pode ser distinguivel pela resposta",
    )
  })

  it("nao vaza estado do assinante em nenhuma chave do corpo", async () => {
    const fixture = new AlertsRouteFixture({
      candidatos_publico: [seedCandidate()],
      alert_subscribers: [
        seedSubscriber({
          email: "verificado@example.com",
          verified: true,
          verified_at: "2026-04-01T10:00:00.000Z",
          verify_token_hash: null,
        }),
      ],
    })

    const corpo = await subscribeBody(fixture, "verificado@example.com", "203.0.113.4")

    for (const chaveProibida of [
      "verified",
      "manageLinkSent",
      "requiresVerification",
      "cooldownActive",
      "emailMasked",
    ]) {
      assert.equal(
        chaveProibida in corpo,
        false,
        `${chaveProibida} revela estado do assinante e nao pode voltar no corpo`,
      )
    }
  })

  it("aplica teto por IP tambem no caminho de assinante ja verificado", async () => {
    // O teto de banco so roda quando o email ainda nao existe. Sem o limitador
    // de processo, uma lista de emails verificados rendia um email por endereco
    // sem nunca esbarrar em teto de IP.
    const fixture = new AlertsRouteFixture({
      candidatos_publico: [seedCandidate()],
      alert_subscribers: [
        seedSubscriber({
          email: "verificado@example.com",
          verified: true,
          verified_at: "2026-04-01T10:00:00.000Z",
          verify_token_hash: null,
        }),
      ],
    })

    const handler = createSubscribeHandler(createDeps(fixture))
    const ip = "203.0.113.9"
    let bloqueou = false

    for (let tentativa = 0; tentativa < 40; tentativa += 1) {
      const response = await handler(subscribeRequest("verificado@example.com", ip))
      if (response.status === 429) {
        bloqueou = true
        break
      }
    }

    assert.equal(bloqueou, true, "o mesmo IP tem de esbarrar em 429 antes de 40 tentativas")
  })
})
