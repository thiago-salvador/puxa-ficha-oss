import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { findSubscriberByManageToken } from "@/lib/alerts"
import { setAlertManageTokenCookie } from "@/lib/alerts-session"
import { normalizeOpaqueToken } from "@/lib/alerts-shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

  // FIXACAO DE SESSAO (master review de 2026-08-03). Antes, qualquer string que
  // casasse com ALERT_TOKEN_RE virava cookie de sessao por 180 dias, sem nenhuma
  // consulta ao banco: bastava mandar a vitima abrir
  // /alertas/acesso?manage=<token-do-atacante> (navegacao top-level GET carrega
  // cookie SameSite=Lax) para a sessao de alertas dela virar a do atacante, e as
  // inscricoes que ela criasse depois caiam na conta dele.
  //
  // O contrato agora e o mesmo do POST /api/alerts/session: so vira cookie o
  // token que corresponde a um assinante real. Token invalido redireciona sem
  // cookie, sem revelar se existe ou nao (a pagina de destino trata o anonimo).
  let subscriber = null
  try {
    subscriber = await findSubscriberByManageToken(manageToken)
  } catch {
    // Indisponibilidade do banco nao pode virar sessao concedida: fail-closed.
    return response
  }
  if (!subscriber) return response

  return setAlertManageTokenCookie(response, manageToken)
}
