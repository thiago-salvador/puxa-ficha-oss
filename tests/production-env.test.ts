import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { validateProductionEnvironment } from "../src/lib/production-env"

const KEYS = [
  "VERCEL_ENV",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PF_QUIZ_SHORT_LINK_SALT",
  "PF_ALERTS_TOKEN_SALT",
  "PF_ALERTS_TOKEN_ENCRYPTION_KEY",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "PF_REVALIDATE_SECRET",
  "PF_INTERNAL_TOKEN",
  "PF_PREVIEW_TOKEN",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "PF_ALERTS_FROM_EMAIL",
  "SMTP_FROM",
] as const

const snapshot: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}

function setCompleteProductionEnv() {
  process.env.VERCEL_ENV = "production"
  process.env.SUPABASE_URL = "https://example.supabase.co"
  process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service"
  process.env.PF_QUIZ_SHORT_LINK_SALT = "quiz-salt-at-least-present-for-test-32chars"
  process.env.PF_ALERTS_TOKEN_SALT = "alerts-token-salt-test-32-characters-xx"
  process.env.PF_ALERTS_TOKEN_ENCRYPTION_KEY = "11".repeat(32)
  process.env.RESEND_API_KEY = "re_test_fake_key_for_unit_test_only"
  process.env.CRON_SECRET = "cron-secret-test-at-least-24-chars-ok"
  process.env.PF_REVALIDATE_SECRET = "revalidate-secret-test-at-least-24-chars"
  process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/123"
}

describe("validateProductionEnvironment", () => {
  beforeEach(() => {
    for (const k of KEYS) {
      snapshot[k] = process.env[k]
    }
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    }
  })

  it("no-op when VERCEL_ENV is not production", () => {
    delete process.env.VERCEL_ENV
    assert.doesNotThrow(() => validateProductionEnvironment())
    process.env.VERCEL_ENV = "preview"
    assert.doesNotThrow(() => validateProductionEnvironment())
    process.env.VERCEL_ENV = "development"
    assert.doesNotThrow(() => validateProductionEnvironment())
  })

  it("throws when production and required vars are missing", () => {
    process.env.VERCEL_ENV = "production"
    for (const k of KEYS) {
      if (k === "VERCEL_ENV") continue
      delete process.env[k]
    }
    assert.throws(() => validateProductionEnvironment(), /\[production-env\]/)
  })

  it("passes when production and all required vars are set", () => {
    setCompleteProductionEnv()
    assert.doesNotThrow(() => validateProductionEnvironment())
  })

  it("keeps internal and preview tokens optional at boot because middleware fails closed", () => {
    setCompleteProductionEnv()
    delete process.env.PF_INTERNAL_TOKEN
    delete process.env.PF_PREVIEW_TOKEN

    assert.doesNotThrow(() => validateProductionEnvironment())
  })

  it("accepts a sender copied with outer quotes and rejects malformed sender values", () => {
    setCompleteProductionEnv()

    process.env.PF_ALERTS_FROM_EMAIL = '"Puxa Ficha <alertas@puxaficha.com.br>"'
    assert.doesNotThrow(() => validateProductionEnvironment())

    process.env.PF_ALERTS_FROM_EMAIL = "Puxa Ficha alertas@puxaficha.com.br"
    assert.throws(
      () => validateProductionEnvironment(),
      /PF_ALERTS_FROM_EMAIL ou SMTP_FROM em formato invalido/,
    )
  })
})
