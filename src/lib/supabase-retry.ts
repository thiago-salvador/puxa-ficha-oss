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

export async function withSupabaseRetry<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<SupabaseRunResult<T>>,
  options: { attemptTimeoutMs?: number } = {}
): Promise<SupabaseRunResult<T>> {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? SUPABASE_ATTEMPT_TIMEOUT_MS
  let lastResult: SupabaseRunResult<T> | null = null
  let lastThrown: unknown = null

  for (let attempt = 1; attempt <= SUPABASE_RETRY_ATTEMPTS; attempt += 1) {
    let timer: ReturnType<typeof setTimeout> | undefined
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

    if (attempt < SUPABASE_RETRY_ATTEMPTS) {
      await sleep(attempt * 250)
    }
  }

  if (lastResult) {
    console.error(`${label} failed after retries:`, lastResult.error?.message)
    return lastResult
  }

  throw lastThrown instanceof Error ? lastThrown : new Error(`${label} failed after retries`)
}
