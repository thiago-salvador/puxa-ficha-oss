import type { CandidatoConfig } from "./types"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export { normalizeForMatch } from "./normalize-for-match"
export { parseCSV } from "./parse-csv-local"

export function loadCandidatos(): CandidatoConfig[] {
  const path = resolve(process.cwd(), "data/candidatos.json")
  return JSON.parse(readFileSync(path, "utf-8"))
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function fetchJSON<T>(
  url: string,
  headers?: Record<string, string>,
  retries = 3,
  timeoutMs = 15000,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers, signal: controller.signal })
      if (res.status === 429) {
        const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"))
        const wait = retryAfter ?? Math.min(5000, 1000 * (i + 1))
        await sleep(wait)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
      return (await res.json()) as T
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (i === retries - 1) throw new Error(`Timeout (${timeoutMs}ms): ${url}`)
        await sleep(2000 * (i + 1))
        continue
      }
      if (i === retries - 1) throw err
      await sleep(1000 * (i + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error("unreachable")
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null

  const asSeconds = Number(value)
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000
  }

  const retryAt = Date.parse(value)
  if (!Number.isNaN(retryAt)) {
    return Math.max(retryAt - Date.now(), 0)
  }

  return null
}
