import { getRankingDefinitionBySlug } from "@/data/ranking-definitions"
import { getRankingDataResource } from "@/lib/api"
import { buildEditorialOg } from "@/lib/og"
import { formatRankingMetricValue } from "@/lib/rankings"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const definition = getRankingDefinitionBySlug(slug)

  if (!definition) {
    return buildEditorialOg({
      eyebrow: "Listas",
      title: "Puxa Ficha",
      subtitle: "Recortes públicos por métricas estruturadas de pré-candidatos mapeados em 2026.",
    })
  }

  const dataset = (await getRankingDataResource(slug, "Presidente")).data
  const leader = dataset.entries[0]
  const subtitle = leader
    ? `Maior valor neste recorte: ${leader.candidato.nome_urna} · ${formatRankingMetricValue(leader.metricValue, definition.metricUnit)}`
    : definition.contextExplanation

  return buildEditorialOg({
    eyebrow: definition.eyebrow,
    title: definition.title,
    subtitle,
    meta: `${definition.metricLabel} · Puxa Ficha`,
  })
}
