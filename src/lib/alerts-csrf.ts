import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

type AlertsApiExitLogger = (
  route: string,
  status: number,
  reason: string,
  detail?: Record<string, unknown>,
) => void

export type AlertsCsrfBlockReason = "csrf_sec_fetch_cross_site" | "csrf_origin_not_allowed"

function addOrigin(origins: Set<string>, value: string | null | undefined) {
  if (!value) return
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`)
    origins.add(parsed.origin)
  } catch {
    // Ignore malformed config; request-origin still protects the route.
  }
}

function allowedAlertsMutationOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>()
  addOrigin(origins, req.nextUrl.origin)
  addOrigin(origins, process.env.NEXT_PUBLIC_SITE_URL)
  addOrigin(origins, process.env.VERCEL_URL)
  addOrigin(origins, "https://puxaficha.com.br")
  addOrigin(origins, "https://www.puxaficha.com.br")
  return origins
}

function getAlertsCsrfBlockReason(req: NextRequest): AlertsCsrfBlockReason | null {
  const secFetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase()
  if (secFetchSite === "cross-site") return "csrf_sec_fetch_cross_site"

  const originHeader = req.headers.get("origin")?.trim()
  if (!originHeader) return null

  let origin: string
  try {
    origin = new URL(originHeader).origin
  } catch {
    return "csrf_origin_not_allowed"
  }

  return allowedAlertsMutationOrigins(req).has(origin) ? null : "csrf_origin_not_allowed"
}

export function rejectCrossSiteAlertsMutation(
  req: NextRequest,
  route: string,
  logAlertsApiExit: AlertsApiExitLogger,
): NextResponse | null {
  const reason = getAlertsCsrfBlockReason(req)
  if (!reason) return null

  logAlertsApiExit(route, 403, reason, {
    origin: req.headers.get("origin") ?? null,
    secFetchSite: req.headers.get("sec-fetch-site") ?? null,
  })
  return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 })
}
