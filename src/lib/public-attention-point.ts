import type { PontoAtencao } from "@/lib/types"

/**
 * Espelha `public.is_public_attention_point` em
 * `supabase/migrations/20260403234500_gate_unverified_ai_attention_points.sql`.
 * RLS em `pontos_atencao` e agregados em `v_ficha_candidato` / `v_comparador` dependem dessa semântica.
 */
export function isPublicAttentionPoint(
  ponto: Pick<PontoAtencao, "visivel" | "gerado_por" | "verificado">,
): boolean {
  return isPublicAttentionPointFields(ponto.visivel, ponto.gerado_por, ponto.verificado)
}

export function isPublicAttentionPointFields(
  visivel: boolean | null | undefined,
  geradoPor: string | null | undefined,
  verificado: boolean | null | undefined,
): boolean {
  const visible = visivel === true
  const generatedBy = geradoPor ?? "curadoria"
  const verified = verificado === true
  return visible && (generatedBy !== "ia" || verified)
}
