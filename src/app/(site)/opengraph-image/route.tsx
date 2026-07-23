import { buildEditorialOg } from "@/lib/og"

export function GET() {
  return buildEditorialOg({
    eyebrow: "Pré-candidatos mapeados",
    title: "Puxa Ficha",
    subtitle:
      "Fontes públicas consultadas para comparar pré-candidatos mapeados em 2026.",
  })
}
