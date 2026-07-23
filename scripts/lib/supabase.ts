import { existsSync } from "node:fs"
import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Lazy-loaded Supabase client.
 *
 * O client é inicializado apenas no primeiro acesso a qualquer propriedade de
 * `supabase` (ex.: `supabase.from(...)`, `supabase.rpc(...)`). Isso evita que
 * o módulo falhe no carregamento quando consumido por testes que não tocam
 * Supabase em runtime, mesmo que suas dependências sejam importadas pela
 * árvore de módulos.
 *
 * Requer `SUPABASE_URL` (ou `NEXT_PUBLIC_SUPABASE_URL`) e
 * `SUPABASE_SERVICE_ROLE_KEY` quando `supabase.*` é efetivamente chamado.
 * Carrega `.env.local` / `.env` via `process.loadEnvFile` se presentes.
 */

let cached: SupabaseClient | null = null

function loadEnvFilesOnce(): void {
  const envFiles = [".env.local", ".env"]
  for (const file of envFiles) {
    const hasUrl = Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)
    const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
    if (hasUrl && hasKey) return

    const envPath = path.resolve(process.cwd(), file)
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath)
    }
  }
}

function getClient(): SupabaseClient {
  if (cached) return cached

  loadEnvFilesOnce()

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  cached = createClient(url, key)
  return cached
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient()
    const value = Reflect.get(client as unknown as object, prop)
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value
  },
  has(_target, prop) {
    return prop in (getClient() as unknown as object)
  },
}) as SupabaseClient

/**
 * Helper explícito para quem quiser forçar a inicialização (por exemplo para
 * validar presença de envs num smoke inicial). Equivale ao comportamento
 * anterior de eager-init no import.
 */
export function ensureSupabaseClient(): SupabaseClient {
  return getClient()
}
