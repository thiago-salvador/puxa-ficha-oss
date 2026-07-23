import * as Sentry from "@sentry/nextjs"

import { sleep } from "./async-utils"

const SUPABASE_RETRY_ATTEMPTS = 3

// Per-attempt timeout so a hung Supabase query degrades gracefully instead of blocking the
// serverless function until the platform limit (~300s) and returning a 504. Worst-case total
// across retries (timeout + backoff per attempt) stays well under that limit; on a healthy
// query the timeout never fires, so behavior is unchanged.
const SUPABASE_ATTEMPT_TIMEOUT_MS = 15_000

type SupabaseRunResult<T> = {
  data: T | null
  error: { message?: string } | null
  /** Preservado quando a consulta Supabase usa `{ count: "exact" }`. */
  count?: number | null
}

/**
 * Labels carregam o slug consultado (`patrimonio(ze-batista)`). Para agrupar no
 * Sentry por operacao, e nao um issue por candidato, o fingerprint usa so a
 * parte estavel do label.
 */
function retryGroupKey(label: string): string {
  return label.replace(/\(.*\)\s*$/, "").trim() || label
}

/**
 * Falha de Supabase que sobrevive a todas as tentativas nao lanca: os callers
 * degradam a pagina e seguem. Sem isto ela so existiria como `console.error` e
 * um span `internal_error` solto, sem issue, sem alerta e sem agrupamento.
 */
function reportExhaustedRetries(params: {
  label: string
  attempts: number
  timeouts: number
  attemptTimeoutMs: number
  lastError?: string
  thrown?: unknown
}): void {
  const { label, attempts, timeouts, attemptTimeoutMs, lastError, thrown } = params
  const timedOut = timeouts > 0

  Sentry.withScope((scope) => {
    scope.setTag("supabase.operation", retryGroupKey(label))
    scope.setTag("supabase.timed_out", timedOut ? "true" : "false")
    scope.setTag("supabase.outcome", thrown ? "threw" : "error_result")
    scope.setContext("supabase_retry", {
      label,
      attempts,
      timeouts,
      attemptTimeoutMs,
      lastError: lastError ?? null,
    })
    scope.setFingerprint(["supabase-retry-exhausted", retryGroupKey(label)])

    if (thrown !== undefined) {
      Sentry.captureException(thrown)
      return
    }
    Sentry.captureMessage(
      `Supabase ${timedOut ? "timeout" : "failure"} after ${attempts} attempts: ${retryGroupKey(label)}`,
      "error"
    )
  })
}

export async function withSupabaseRetry<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<SupabaseRunResult<T>>,
  options: { attemptTimeoutMs?: number } = {}
): Promise<SupabaseRunResult<T>> {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? SUPABASE_ATTEMPT_TIMEOUT_MS
  let lastResult: SupabaseRunResult<T> | null = null
  let lastThrown: unknown = null
  let timeouts = 0

  for (let attempt = 1; attempt <= SUPABASE_RETRY_ATTEMPTS; attempt += 1) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let attemptTimedOut = false
    // Aborta a tentativa no timeout. Callers que repassam o signal para
    // `.abortSignal()` do PostgREST liberam o slot de conexao em vez de deixar a
    // query pendurada; callers antigos (assinatura `() => ...`) ignoram o arg e
    // mantem o comportamento anterior.
    const controller = new AbortController()
    try {
      const result = await Promise.race<SupabaseRunResult<T>>([
        run(controller.signal),
        new Promise<SupabaseRunResult<T>>((resolve) => {
          timer = setTimeout(() => {
            attemptTimedOut = true
            timeouts += 1
            controller.abort()
            resolve({ data: null, error: { message: `${label} timed out after ${attemptTimeoutMs}ms` } })
          }, attemptTimeoutMs)
        }),
      ])
      if (!result.error) {
        return result
      }
      lastResult = result
    } catch (error) {
      lastThrown = error
    } finally {
      if (timer) clearTimeout(timer)
    }

    // Trilha da tentativa que falhou. Vira contexto do evento se as retentativas
    // se esgotarem, e nao emite nada quando a proxima tentativa recupera.
    Sentry.addBreadcrumb({
      category: "supabase",
      level: "warning",
      message: `${label} attempt ${attempt}/${SUPABASE_RETRY_ATTEMPTS} failed`,
      data: {
        timedOut: attemptTimedOut,
        attemptTimeoutMs,
        error: lastThrown ? String(lastThrown) : (lastResult?.error?.message ?? null),
      },
    })

    if (attempt < SUPABASE_RETRY_ATTEMPTS) {
      await sleep(attempt * 250)
    }
  }

  if (lastResult) {
    console.error(`${label} failed after retries:`, lastResult.error?.message)
    reportExhaustedRetries({
      label,
      attempts: SUPABASE_RETRY_ATTEMPTS,
      timeouts,
      attemptTimeoutMs,
      lastError: lastResult.error?.message,
    })
    return lastResult
  }

  const thrown = lastThrown instanceof Error ? lastThrown : new Error(`${label} failed after retries`)
  reportExhaustedRetries({
    label,
    attempts: SUPABASE_RETRY_ATTEMPTS,
    timeouts,
    attemptTimeoutMs,
    lastError: thrown.message,
    thrown,
  })
  throw thrown
}
