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
    // O profile `"max"` foi substituido por `{ expire: 0 }`. A diferenca
    // importa num site de checagem:
    //
    //   revalidateTag(tag, "max") -> marca como stale. A PROXIMA requisicao
    //     ainda recebe a versao ANTIGA, e so a seguinte ve a corrigida.
    //   revalidateTag(tag, { expire: 0 }) -> expira de imediato. A proxima
    //     requisicao e um miss bloqueante e ja devolve a versao corrigida.
    //
    // Depois de corrigir um erro factual numa ficha, servir a versao errada mais
    // uma vez e inaceitavel aqui. Por isso o profile de expiracao imediata.
    //
    // `updateTag(tag)` seria a API nova para expiracao imediata, mas ela LANCA
    // fora de Server Action: o proprio Next checa `workStore.page.endsWith("/route")`
    // e joga E872. Esta rota e um Route Handler, entao updateTag nao e opcao.
    // Verificado em next@16.2.12, node_modules/next/dist/server/web/spec-extension/revalidate.js.
    //
    // `{ expire: 0 }` e a forma TIPADA de pedir expiracao imediata. O runtime do
    // Next trata os dois casos no mesmo ramo:
    //
    //     if (!profile || cacheLife?.expire === 0) { ...expira de imediato... }
    //
    // Omitir o argumento tambem expiraria de imediato, mas nao compila (o tipo
    // exige 2 argumentos) e emitiria aviso de deprecacao. Com `{ expire: 0 }`
    // nao ha aviso nem deprecacao.
    revalidateFn: (tag) => revalidateTag(tag, { expire: 0 }),
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
