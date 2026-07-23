import "server-only"

import {
  ANALYTICS_EVENT_NAMES,
  type AnalyticsEventName,
  type AnalyticsPayload,
  getAnalyticsProofIdFromPayload,
} from "@/lib/analytics-events"
import { createServiceRoleSupabaseClient } from "@/lib/supabase"

export type AnalyticsLaunchCounts = Record<AnalyticsEventName, number>

function emptyCounts(): AnalyticsLaunchCounts {
  return Object.fromEntries(ANALYTICS_EVENT_NAMES.map((eventName) => [eventName, 0])) as AnalyticsLaunchCounts
}

export async function recordAnalyticsLaunchEvent(input: {
  eventName: AnalyticsEventName
  payload: AnalyticsPayload
}) {
  const supabase = createServiceRoleSupabaseClient({ cacheMode: "no-store" })
  const proofId = getAnalyticsProofIdFromPayload(input.payload)
  const { error } = await supabase.from("analytics_launch_events").insert({
    event_name: input.eventName,
    payload: input.payload,
    proof_id: proofId,
  })

  if (error) {
    throw new Error(`analytics_launch_events insert failed: ${error.message}`)
  }
}

export async function readAnalyticsLaunchCounts(input: {
  sinceIso: string
  proofId?: string | null
}): Promise<{ counts: AnalyticsLaunchCounts; missing: AnalyticsEventName[] }> {
  const supabase = createServiceRoleSupabaseClient({ cacheMode: "no-store" })
  let query = supabase
    .from("analytics_launch_events")
    .select("event_name")
    .gte("created_at", input.sinceIso)

  if (input.proofId) {
    query = query.eq("proof_id", input.proofId)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`analytics_launch_events readback failed: ${error.message}`)
  }

  const counts = emptyCounts()
  for (const row of data ?? []) {
    const eventName = row.event_name as AnalyticsEventName
    if (Object.prototype.hasOwnProperty.call(counts, eventName)) {
      counts[eventName] += 1
    }
  }

  return {
    counts,
    missing: ANALYTICS_EVENT_NAMES.filter((eventName) => counts[eventName] <= 0),
  }
}
