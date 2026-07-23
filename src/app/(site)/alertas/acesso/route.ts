import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { setAlertManageTokenCookie } from "@/lib/alerts-session"
import { normalizeOpaqueToken } from "@/lib/alerts-shared"

function buildRedirectUrl(req: NextRequest, verifyToken: string | null, hash: string | null): URL {
  const target = verifyToken ? `/alertas/verificar?token=${encodeURIComponent(verifyToken)}` : "/alertas/gerenciar"
  const url = new URL(target, req.nextUrl.origin)
  if (!verifyToken && hash) url.hash = hash
  return url
}

export async function GET(req: NextRequest) {
  const manageToken = normalizeOpaqueToken(req.nextUrl.searchParams.get("manage") ?? "")
  const verifyToken = normalizeOpaqueToken(req.nextUrl.searchParams.get("verify") ?? "")
  const hashRaw = req.nextUrl.searchParams.get("hash") ?? ""
  const hash = hashRaw === "deletar-dados" || hashRaw === "cancelar-tudo" ? hashRaw : null

  const response = NextResponse.redirect(buildRedirectUrl(req, verifyToken, hash))
  if (!manageToken) return response
  return setAlertManageTokenCookie(response, manageToken)
}
