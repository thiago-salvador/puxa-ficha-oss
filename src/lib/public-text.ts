const TSE_NULL_MARKER_RE = /#(?:NULO|NE)#?/gi

/** Remove marcadores técnicos do TSE antes de qualquer texto chegar à ficha pública. */
export function sanitizePublicText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(TSE_NULL_MARKER_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}
