import { supabase } from "./supabase"

export async function resolveCandidatoId(slug: string): Promise<string | null> {
  const { data } = await supabase.from("candidatos").select("id").eq("slug", slug).single()
  return data?.id ?? null
}
