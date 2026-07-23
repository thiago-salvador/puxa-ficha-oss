import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import {
  executeRevalidateRequest,
  extractRevalidateSecret,
  REVALIDATE_ALLOWED_TAGS,
} from "@/lib/revalidate-cache"
import {
  isRequestBodyTooLargeError,
  readJsonBodyWithLimit,
} from "@/lib/request-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function jsonNoStore(body: Record<string, unknown>, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init)
  response.headers.set(
    "cache-control",
    "private, no-store, no-cache, must-revalidate, max-age=0",
  )
  return response
}

/**
 * POST /api/revalidate
 *
 * Endpoint protegido para invalidar tags de `unstable_cache` apos write em remoto
 * (apply factual, edicao manual, etc.) sem esperar a janela de revalidate=3600s
 * do ISR. Falha fechada: sem `PF_REVALIDATE_SECRET` no env, retorna 503.
 *
 * Auth (em ordem de preferencia):
 *  - `x-pf-revalidate-secret: <secret>` (preferencial)
 *  - `Authorization: Bearer <secret>` (fallback operacional)
 *  - query string NAO e aceita.
 *
 * Body:
 *  - `{ "tag": "public-candidatos" }`
 *  - `{ "tags": ["public-candidatos", "public-candidato-ficha"] }`
 *
 * Whitelist em `src/lib/revalidate-cache.ts`. Tag fora da whitelist => 400 e
 * NENHUMA tag e revalidada (all-or-nothing).
 */
export async function POST(req: NextRequest) {
  const providedSecret = extractRevalidateSecret(req.headers)

  let body: unknown = null
  try {
    body = await readJsonBodyWithLimit(req)
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return jsonNoStore({ ok: false, error: "payload_too_large" }, { status: 413 })
    }
    body = null
  }

  const result = executeRevalidateRequest({
    body,
    providedSecret,
    envSecret: process.env.PF_REVALIDATE_SECRET,
    // Next 16 exige profile como segundo argumento; "max" mapeia para o lifecycle
    // mais longo registrado, equivalente ao comportamento legado de revalidateTag(tag).
    revalidateFn: (tag) => revalidateTag(tag, "max"),
  })

  if (result.ok) {
    console.log(
      `[revalidate] ok status=200 tags=${result.revalidated.join(",")}`,
    )
    return jsonNoStore(
      { ok: true, revalidated: result.revalidated },
      { status: 200 },
    )
  }

  console.warn(
    `[revalidate] reject status=${result.status} reason=${result.reason ?? "unknown"} rejected=${result.rejected.join(",")}`,
  )

  if (result.status === 503) {
    return jsonNoStore(
      {
        ok: false,
        error: "revalidate_endpoint_disabled",
        reason: "PF_REVALIDATE_SECRET nao configurado no servidor",
      },
      { status: 503 },
    )
  }

  if (result.status === 401) {
    return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  // 400: body invalido ou tag fora da whitelist.
  return jsonNoStore(
    {
      ok: false,
      error: "invalid_request",
      reason: result.reason ?? "invalid",
      allowedTags: REVALIDATE_ALLOWED_TAGS,
    },
    { status: 400 },
  )
}

/**
 * GET nao revalida; retorna 405 com ponteiro pra contrato. Mantemos GET para
 * que probe operacional (curl GET) nao caia em rota dinamica fantasma.
 */
export async function GET() {
  return jsonNoStore(
    { ok: false, error: "method_not_allowed", method: "GET" },
    { status: 405 },
  )
}
