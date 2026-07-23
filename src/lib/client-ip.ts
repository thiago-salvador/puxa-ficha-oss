/**
 * Extrai o IP do cliente para rate limit / hash em rotas públicas.
 *
 * Em produção, a política é Vercel-only: só `x-vercel-forwarded-for` é aceito
 * como fonte canônica. Fora da Vercel, a função falha fechada para `"unknown"`,
 * agrupando a requisição no mesmo bucket em vez de confiar em header
 * forwardável pelo cliente.
 *
 * Em desenvolvimento/teste aceitamos `x-real-ip` e o último valor de
 * `x-forwarded-for` para manter fixtures e smoke local operáveis.
 */
export function extractTrustedClientIp(headers: Pick<Headers, "get">): string {
  const vercel = headers.get("x-vercel-forwarded-for")?.trim()
  if (vercel) {
    const first = vercel.split(",")[0]?.trim()
    if (first) return first
  }

  const isLocalRuntime = process.env.NODE_ENV !== "production" && !process.env.VERCEL_ENV
  if (!isLocalRuntime) return "unknown"

  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  const xForwardedFor = headers.get("x-forwarded-for")
  if (xForwardedFor) {
    const parts = xForwardedFor
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    const last = parts[parts.length - 1]
    if (last) return last
  }

  return "unknown"
}
