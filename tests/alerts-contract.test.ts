import assert from "node:assert"
import { test, describe } from "node:test"
import {
  normalizeAlertEmail,
  maskAlertEmail,
  normalizeCandidateSlug,
  normalizeOpaqueToken,
  createAlertVerifyExpiryDate,
  buildAlertVerifyUrl,
  buildAlertManageUrl,
  buildAlertDeleteDataUrl,
  buildAlertUnsubscribeUrl,
} from "@/lib/alerts-shared"
import { sanitizeAlertsLogDetail } from "@/lib/alerts-log"
import { readFileSync } from "fs"

describe("Alerts contract", () => {
  describe("Helpers públicos de alerta", () => {
    test("normalizeAlertEmail normaliza email válido", () => {
      const result = normalizeAlertEmail(" Eleitor+Teste@Example.COM ")
      assert.strictEqual(result, "eleitor+teste@example.com")
    })

    test("normalizeAlertEmail retorna null para email inválido", () => {
      const result = normalizeAlertEmail("sem-arroba")
      assert.strictEqual(result, null)
    })

    test("normalizeCandidateSlug normaliza slug válido", () => {
      const result = normalizeCandidateSlug(" Lula ")
      assert.strictEqual(result, "lula")
    })

    test("normalizeCandidateSlug retorna null para slug inválido com espaço interno", () => {
      const result = normalizeCandidateSlug("lula silva")
      assert.strictEqual(result, null)
    })

    test("normalizeOpaqueToken aceita token com 16+ chars em [A-Za-z0-9_-]", () => {
      const result = normalizeOpaqueToken("AbCd1234_-xyzXYZ")
      assert.strictEqual(result, "AbCd1234_-xyzXYZ")
    })

    test("normalizeOpaqueToken rejeita token curto", () => {
      const result = normalizeOpaqueToken("short")
      assert.strictEqual(result, null)
    })

    test("createAlertVerifyExpiryDate expira 48h depois", () => {
      const now = new Date("2026-04-10T15:00:00Z")
      const expiry = createAlertVerifyExpiryDate(now)
      const diffMs = expiry.getTime() - now.getTime()
      const expectedMs = 48 * 60 * 60 * 1000
      assert.strictEqual(diffMs, expectedMs)
    })

    test("maskAlertEmail não expõe o local-part completo", () => {
      const result = maskAlertEmail("eleitor@example.com")
      assert.ok(!result.includes("eleitor"), "local-part completo não deve aparecer")
      assert.ok(result.includes("@"), "deve conter @")
      assert.ok(result.includes("example.com"), "domínio deve aparecer")
    })
  })

  describe("URLs e tokens", () => {
    test("buildAlertVerifyUrl contém verify= e manage=", () => {
      const url = buildAlertVerifyUrl("verify-token-123456", "manage-token-123456")
      assert.ok(url.includes("verify="), "deve conter verify=")
      assert.ok(url.includes("manage="), "deve conter manage=")
    })

    test("buildAlertManageUrl contém manage=", () => {
      const url = buildAlertManageUrl("manage-token-123456")
      assert.ok(url.includes("manage="), "deve conter manage=")
    })

    test("buildAlertDeleteDataUrl contém hash=deletar-dados", () => {
      const url = buildAlertDeleteDataUrl("manage-token-123456")
      assert.ok(url.includes("hash=deletar-dados"), "deve conter hash=deletar-dados")
    })

    test("buildAlertUnsubscribeUrl contém hash=cancelar-tudo", () => {
      const url = buildAlertUnsubscribeUrl("manage-token-123456")
      assert.ok(url.includes("hash=cancelar-tudo"), "deve conter hash=cancelar-tudo")
    })
  })

  describe("Logs", () => {
    test("sanitizeAlertsLogDetail redige email, nested.to e nested.email_hash", () => {
      const input = {
        email: "a@b.com",
        emailMasked: "a***@b.com",
        nested: { to: "x@y.com", email_hash: "abc" },
      }
      const result = sanitizeAlertsLogDetail(input) as Record<string, unknown>

      assert.strictEqual(result.email, "[REDACTED]", "email deve ser redigido")
      assert.strictEqual((result.nested as Record<string, unknown>).to, "[REDACTED]", "nested.to deve ser redigido")
      assert.strictEqual((result.nested as Record<string, unknown>).email_hash, "[REDACTED]", "nested.email_hash deve ser redigido")
      assert.strictEqual(result.emailMasked, "a***@b.com", "emailMasked deve ser preservado")
    })
  })

  describe("Rotas como contrato estático", () => {
    test("subscribe/route.ts exporta createSubscribeHandler", () => {
      const content = readFileSync("src/app/api/alerts/subscribe/route.ts", "utf-8")
      assert.match(content, /export function createSubscribeHandler/, "deve exportar createSubscribeHandler")
    })

    test("verify/route.ts exporta createVerifyHandler", () => {
      const content = readFileSync("src/app/api/alerts/verify/route.ts", "utf-8")
      assert.match(content, /export function createVerifyHandler/, "deve exportar createVerifyHandler")
    })

    test("toggle/route.ts exporta createToggleHandler", () => {
      const content = readFileSync("src/app/api/alerts/toggle/route.ts", "utf-8")
      assert.match(content, /export function createToggleHandler/, "deve exportar createToggleHandler")
    })

    test("send-digest/route.ts exporta createSendDigestHandler", () => {
      const content = readFileSync("src/app/api/alerts/send-digest/route.ts", "utf-8")
      assert.match(content, /export function createSendDigestHandler/, "deve exportar createSendDigestHandler")
    })

    test("send-digest/route.ts referencia CRON_SECRET", () => {
      const content = readFileSync("src/app/api/alerts/send-digest/route.ts", "utf-8")
      assert.match(content, /CRON_SECRET/, "deve referenciar CRON_SECRET")
    })

    test("send-digest/route.ts usa notification_log", () => {
      const content = readFileSync("src/app/api/alerts/send-digest/route.ts", "utf-8")
      assert.match(content, /notification_log/, "deve usar notification_log")
    })

    test("send-digest/route.ts usa buildAlertDigestEmail", () => {
      const content = readFileSync("src/app/api/alerts/send-digest/route.ts", "utf-8")
      assert.match(content, /buildAlertDigestEmail/, "deve usar buildAlertDigestEmail")
    })

    test("send-digest/route.ts configura header List-Unsubscribe", () => {
      const content = readFileSync("src/app/api/alerts/send-digest/route.ts", "utf-8")
      assert.match(content, /List-Unsubscribe/, "deve configurar header List-Unsubscribe")
    })

    test("send-digest/route.ts atualiza last_digest_sent_at", () => {
      const content = readFileSync("src/app/api/alerts/send-digest/route.ts", "utf-8")
      assert.match(content, /last_digest_sent_at/, "deve atualizar last_digest_sent_at")
    })

    test("cliente de alertas não importa helpers server-only", () => {
      const content = readFileSync("src/lib/alerts-client.ts", "utf-8")
      assert.doesNotMatch(
        content,
        /alerts-shared/,
        "alerts-client.ts não deve importar alerts-shared, que puxa node:crypto para o bundle cliente",
      )
      assert.match(
        content,
        /alerts-client-storage/,
        "constantes de localStorage devem vir de módulo client-safe",
      )
    })
  })
})
