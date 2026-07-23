import { NextResponse } from "next/server"
import {
  isAnalyticsEventName,
  sanitizeAnalyticsPayload,
} from "@/lib/analytics-events"
import { recordAnalyticsLaunchEvent } from "@/lib/analytics-launch-store"
import {
  createFixedWindowIpRateLimiter,
  rateLimitExceededResponse,
  type RequestRateLimiter,
} from "@/lib/request-rate-limit"
import { rejectCrossSitePublicWrite } from "@/lib/public-write-origin-guard"
import {
  isRequestBodyTooLargeError,
  readJsonBodyWithLimit,
} from "@/lib/request-body"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const analyticsEventRateLimiter = createFixedWindowIpRateLimiter({
  namespace: "analytics-event",
  max: 120,
  windowMs: 60_000,
})

interface AnalyticsEventDeps {
  recordAnalyticsLaunchEvent: typeof recordAnalyticsLaunchEvent
  rateLimiter: RequestRateLimiter
}

const defaultAnalyticsEventDeps: AnalyticsEventDeps = {
  recordAnalyticsLaunchEvent,
  rateLimiter: analyticsEventRateLimiter,
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await readJsonBodyWithLimit(req)
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) throw error
    return null
  }
}
export function createAnalyticsEventPostHandler(deps: AnalyticsEventDeps = defaultAnalyticsEventDeps) {
  return async function POST(req: Request) {
    const blocked = rejectCrossSitePublicWrite(req)
    if (blocked) return blocked

    try {
      const decision = deps.rateLimiter.check(req.headers)
      if (!decision.allowed) return rateLimitExceededResponse(decision)
    } catch (error) {
      console.error("analytics event rate limit failed closed", error)
      return NextResponse.json(
        { ok: false, reason: "rate_limit_failed" },
        { status: 503, headers: { "cache-control": "no-store" } },
      )
    }

    let body: unknown
    try {
      body = await readJson(req)
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        return NextResponse.json({ ok: false, reason: "body_too_large" }, { status: 413 })
      }
      throw error
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 })
    }

    const eventName = (body as { eventName?: unknown }).eventName
    if (!isAnalyticsEventName(eventName)) {
      return NextResponse.json({ ok: false, reason: "invalid_event" }, { status: 400 })
    }

    const payload = sanitizeAnalyticsPayload((body as { payload?: unknown }).payload)

    try {
      await deps.recordAnalyticsLaunchEvent({ eventName, payload })
      return NextResponse.json(
        { ok: true },
        { headers: { "cache-control": "no-store" } },
      )
    } catch (error) {
      console.error("analytics event ingest failed", error)
      return NextResponse.json({ ok: false, reason: "store_failed" }, { status: 503 })
    }
  }
}

export const POST = createAnalyticsEventPostHandler()
