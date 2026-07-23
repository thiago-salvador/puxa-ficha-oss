import { NextResponse } from "next/server"

type HeadersLike = Pick<Headers, "get">

export type PublicWriteOriginBlockReason =
  | "csrf_sec_fetch_cross_site"
  | "csrf_origin_not_allowed"

interface PublicWriteRequestLike {
  url: string
  headers: HeadersLike
}

function addOrigin(origins: Set<string>, value: string | null | undefined) {
  if (!value) return
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`)
    origins.add(parsed.origin)
  } catch {
    // Malformed config is ignored; request origin still protects the route.
  }
}

function allowedPublicWriteOrigins(req: PublicWriteRequestLike): Set<string> {
  const origins = new Set<string>()
  addOrigin(origins, new URL(req.url).origin)
  addOrigin(origins, process.env.NEXT_PUBLIC_SITE_URL)
  addOrigin(origins, process.env.VERCEL_URL)
  addOrigin(origins, "https://puxaficha.com.br")
  addOrigin(origins, "https://www.puxaficha.com.br")
  return origins
}

function getPublicWriteOriginBlockReason(
  req: PublicWriteRequestLike,
): PublicWriteOriginBlockReason | null {
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

  return allowedPublicWriteOrigins(req).has(origin) ? null : "csrf_origin_not_allowed"
}

export function rejectCrossSitePublicWrite(req: PublicWriteRequestLike): NextResponse | null {
  const reason = getPublicWriteOriginBlockReason(req)
  if (!reason) return null

  return NextResponse.json(
    { error: "Cross-site request blocked" },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
        "x-pf-block-reason": reason,
      },
    },
  )
}
