import {
  createFixedWindowIpRateLimiter,
  type RateLimitDecision,
  type RequestRateLimiter,
} from "@/lib/request-rate-limit"

// Cada termo distinto de 3+ caracteres em /doadores?q= vira um full scan de
// ~380 ms no Postgres do plano Free (search_financiamento_by_doador_normalized
// faz substring sobre função linha a linha, não indexável). O Data Cache só
// protege termos repetidos; um crawler com termos aleatórios vira carga
// sustentada no banco. Janela generosa para humanos, curta para script.
export const DOADORES_SEARCH_RATE_LIMIT_MAX = 12
export const DOADORES_SEARCH_RATE_LIMIT_WINDOW_MS = 60_000

export const doadoresSearchRateLimiter: RequestRateLimiter =
  createFixedWindowIpRateLimiter({
    namespace: "doadores-search",
    max: DOADORES_SEARCH_RATE_LIMIT_MAX,
    windowMs: DOADORES_SEARCH_RATE_LIMIT_WINDOW_MS,
  })

/** Segundos até a janela liberar, para a cópia "aguarde Ns" da página. */
export function retryAfterSeconds(decision: RateLimitDecision, now = Date.now()): number {
  return Math.max(1, Math.ceil((decision.resetAt - now) / 1000))
}
