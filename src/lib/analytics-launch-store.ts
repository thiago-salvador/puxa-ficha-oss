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

/**
 * A coluna `ip_hash` chega pela migration `..._analytics_launch_events_ip_hash`.
 * Enquanto ela não estiver aplicada, o PostgREST responde coluna desconhecida
 * (`42703` na leitura, `PGRST204` na escrita). Reconhecer essa assinatura é o que
 * permite que o deploy do código e a aplicação da migration aconteçam em qualquer
 * ordem sem derrubar a ingestão de eventos: sem coluna, o limite durável não roda
 * e o limite em memória continua sendo o teto.
 */
function isMissingIpHashColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === "42703" || error.code === "PGRST204") return true
  const message = error.message?.toLowerCase() ?? ""
  return message.includes("ip_hash") && (message.includes("column") || message.includes("schema cache"))
}

export type AnalyticsIpHashCount =
  | { status: "ok"; count: number }
  | { status: "coluna_ausente" }

/**
 * Conta eventos aceitos do mesmo cliente na janela. É o lado durável do limite:
 * ao contrário do contador em memória, sobrevive a troca de instância e é
 * compartilhado por todas elas. Mesmo formato do `countRecentByIpHash` de
 * `/api/quiz/short-link`.
 */
export async function countRecentAnalyticsEventsByIpHash(
  ipHash: string,
  sinceIso: string,
): Promise<AnalyticsIpHashCount> {
  const supabase = createServiceRoleSupabaseClient({ cacheMode: "no-store" })
  const { count, error } = await supabase
    .from("analytics_launch_events")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceIso)

  if (error) {
    if (isMissingIpHashColumn(error)) return { status: "coluna_ausente" }
    throw new Error(`analytics_launch_events rate count failed: ${error.message}`)
  }

  return { status: "ok", count: count ?? 0 }
}

interface AnalyticsLaunchEventRow {
  event_name: AnalyticsEventName
  payload: AnalyticsPayload
  proof_id: string | null
  ip_hash?: string
}

export async function recordAnalyticsLaunchEvent(input: {
  eventName: AnalyticsEventName
  payload: AnalyticsPayload
  ipHash?: string | null
}) {
  const supabase = createServiceRoleSupabaseClient({ cacheMode: "no-store" })
  const proofId = getAnalyticsProofIdFromPayload(input.payload)
  const row: AnalyticsLaunchEventRow = {
    event_name: input.eventName,
    payload: input.payload,
    proof_id: proofId,
  }
  const rowComIpHash: AnalyticsLaunchEventRow = input.ipHash
    ? { ...row, ip_hash: input.ipHash }
    : row

  const { error } = await supabase.from("analytics_launch_events").insert(rowComIpHash)

  if (!error) return

  // Sem a coluna ainda, grava o evento sem o identificador em vez de perdê-lo:
  // analytics é sink de auditoria, e um evento a menos não volta.
  if (input.ipHash && isMissingIpHashColumn(error)) {
    const { error: retryError } = await supabase.from("analytics_launch_events").insert(row)
    if (!retryError) return
    throw new Error(`analytics_launch_events insert failed: ${retryError.message}`)
  }

  throw new Error(`analytics_launch_events insert failed: ${error.message}`)
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
