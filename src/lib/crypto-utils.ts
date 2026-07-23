import { createHash } from "node:crypto"

/** SHA-256 em hex minúsculo — primitive compartilhado (alertas, doadores Fase 2, etc.). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}
