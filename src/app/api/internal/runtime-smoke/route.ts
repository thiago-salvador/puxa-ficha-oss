import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

interface RuntimeSmokeDeps {
  fetchImpl: typeof fetch
  expectedSecret: string | undefined
  origin: string
}

interface RuntimeCheck {
  name: string
  path: string
  status: number
  marker?: string
}

const CHECKS: RuntimeCheck[] = [
  { name: "home", path: "/", status: 200, marker: "Puxa Ficha" },
  { name: "candidate", path: "/candidato/lula", status: 200, marker: "Lula" },
  { name: "profile-api", path: "/api/candidato-profile/lula", status: 200, marker: '"slug":"lula"' },
  { name: "deployment-info", path: "/api/deployment-info", status: 200 },
  { name: "real-404", path: "/candidato/pf-runtime-smoke-inexistente", status: 404 },
]

function bearer(req: NextRequest): string | null {
  const value = req.headers.get("authorization")?.trim()
  return value?.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : null
}

export function createRuntimeSmokeHandler(deps: RuntimeSmokeDeps) {
  return async function runtimeSmoke(req: NextRequest) {
    if (!deps.expectedSecret?.trim() || bearer(req) !== deps.expectedSecret.trim()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const origin = deps.origin.replace(/\/$/, "")
    const results = await Promise.all(
      CHECKS.map(async (check) => {
        try {
          const response = await deps.fetchImpl(`${origin}${check.path}`, {
            cache: "no-store",
            headers: { "user-agent": "puxaficha-runtime-smoke/1.0" },
            signal: AbortSignal.timeout(10_000),
          })
          const body = check.marker ? await response.text() : ""
          const ok = response.status === check.status && (!check.marker || body.includes(check.marker))
          return { name: check.name, ok, status: response.status }
        } catch (error) {
          return {
            name: check.name,
            ok: false,
            status: null,
            error: error instanceof Error ? error.name : "fetch_failed",
          }
        }
      }),
    )

    const failed = results.filter((result) => !result.ok)
    if (failed.length > 0) {
      console.error(`[runtime-smoke] failed ${JSON.stringify({ failed })}`)
      return NextResponse.json({ ok: false, failed, total: results.length }, { status: 500 })
    }

    console.log(`[runtime-smoke] ok ${JSON.stringify({ total: results.length })}`)
    return NextResponse.json(
      { ok: true, total: results.length, results },
      { status: 200, headers: { "cache-control": "no-store" } },
    )
  }
}

export const GET = createRuntimeSmokeHandler({
  fetchImpl: fetch,
  expectedSecret: process.env.CRON_SECRET,
  origin: process.env.PF_RUNTIME_SMOKE_ORIGIN?.trim() || "https://puxaficha.com.br",
})
