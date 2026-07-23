/**
 * Cargo canônico para deduplicação e UNIQUE (candidato_id, cargo_canonico, periodo_inicio).
 * Mantido alinhado a `scripts/lib/cargo-utils.ts` (re-export) e ingestões TSE/Wikidata.
 */

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()

/**
 * Reduz variantes de texto (TSE vs Wikidata vs manual) a uma chave estável.
 */
export function canonicalCargo(cargo: string): string {
  const raw = cargo.trim()
  if (!raw) return raw
  const s = strip(raw)
  const role = s.replace(/[()]/g, " ").replace(/\s+/g, " ").trim()
  const compactRole = role.replace(/\b([oa])\b/g, " ").replace(/\s+/g, " ").trim()

  if (/^vice[- ]president[ea]/.test(compactRole)) return "Vice-Presidente"
  if (
    compactRole === "presidente" ||
    compactRole.includes("presidente da republica") ||
    compactRole.includes("presidente do brasil")
  ) {
    return "Presidente"
  }
  if (/^vice[- ]governador[ae]?/.test(compactRole)) return "Vice-Governador"
  if (/^governador[ae]?/.test(compactRole)) return "Governador"
  if (/^vice[- ]prefeit[oa]/.test(compactRole)) return "Vice-Prefeito"
  if (/^prefeit[oa]/.test(compactRole)) return "Prefeito"
  if (/deputad[oa]?\s+federal/.test(compactRole)) return "Deputado Federal"
  if (/deputad[oa]?\s+estadual/.test(compactRole)) return "Deputado Estadual"
  if (/deputad[oa]?\s+distrital/.test(compactRole)) return "Deputado Distrital"
  if (/^senador(?:a)?(?:\b|$)/.test(compactRole)) return "Senador"
  if (/^vereador(?:a)?(?:\b|$)/.test(compactRole)) return "Vereador"
  if (compactRole.includes("presidente do sebrae")) return "Presidente do Sebrae"
  if (/^ministr[oa]/.test(compactRole)) return raw.replace(/\s+/g, " ").trim()
  if (/^secretari[oa]/.test(compactRole)) {
    if (compactRole.includes("de estado")) return "Secretário"
    return raw.replace(/\s+/g, " ").trim()
  }

  return raw.replace(/\s+/g, " ").trim()
}
