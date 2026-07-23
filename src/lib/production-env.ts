import { isValidConfiguredFromEmail, resolveConfiguredFromEmail } from "@/lib/email-from"

/**
 * Validação de ambiente em deploy de produção (Vercel).
 * Chamada a partir de `instrumentation.ts` no runtime Node.
 */

function hasTrimmed(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function isHex32Bytes(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value)
}

/**
 * Falha rápido no boot do servidor em produção se variáveis críticas faltarem.
 * Não roda em preview/local para não quebrar `next build` sem .env completo.
 */
export function validateProductionEnvironment(): void {
  if (process.env.VERCEL_ENV !== "production") {
    return
  }

  const missing: string[] = []

  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anon =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url) missing.push("SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_URL")
  if (!anon) missing.push("SUPABASE_ANON_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY")
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY")

  if (!hasTrimmed(process.env.PF_QUIZ_SHORT_LINK_SALT)) {
    missing.push("PF_QUIZ_SHORT_LINK_SALT")
  }

  if (!hasTrimmed(process.env.PF_ALERTS_TOKEN_SALT)) {
    missing.push("PF_ALERTS_TOKEN_SALT")
  }

  if (!hasTrimmed(process.env.PF_ALERTS_IP_SALT) && !hasTrimmed(process.env.PF_QUIZ_SHORT_LINK_SALT)) {
    missing.push("PF_ALERTS_IP_SALT ou PF_QUIZ_SHORT_LINK_SALT")
  }

  const enc = process.env.PF_ALERTS_TOKEN_ENCRYPTION_KEY?.trim()
  if (!enc || !isHex32Bytes(enc)) {
    missing.push("PF_ALERTS_TOKEN_ENCRYPTION_KEY (64 caracteres hex = 32 bytes)")
  }

  if (!hasTrimmed(process.env.RESEND_API_KEY)) {
    missing.push("RESEND_API_KEY")
  }

  if (!hasTrimmed(process.env.CRON_SECRET)) {
    missing.push("CRON_SECRET")
  }

  if (!hasTrimmed(process.env.PF_REVALIDATE_SECRET)) {
    missing.push("PF_REVALIDATE_SECRET")
  }

  const sentryDsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  if (!sentryDsn) {
    missing.push("SENTRY_DSN ou NEXT_PUBLIC_SENTRY_DSN")
  }

  const configuredFromRaw = process.env.PF_ALERTS_FROM_EMAIL?.trim() || process.env.SMTP_FROM?.trim()
  if (configuredFromRaw) {
    const normalizedFrom = resolveConfiguredFromEmail(
      process.env.PF_ALERTS_FROM_EMAIL,
      process.env.SMTP_FROM,
    )
    if (!isValidConfiguredFromEmail(normalizedFrom)) {
      missing.push("PF_ALERTS_FROM_EMAIL ou SMTP_FROM em formato invalido")
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[production-env] Deploy em VERCEL_ENV=production com configuração incompleta: ${missing.join("; ")}`,
    )
  }
}
