import { getCandidatoBySlugResource } from "@/lib/api"
import { buildEditorialOg } from "@/lib/og"
import { formatPartyPublicLabel } from "@/lib/party-utils"
import { buildTimelineEvents } from "@/lib/timeline-utils"
import {
  buildTimelineOgFallbackSubtitle,
  buildTimelineOgSubtitle,
  formatCargoDisputadoPublicLabel,
} from "@/lib/ui-labels"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const ficha = (await getCandidatoBySlugResource(slug)).data

  if (!ficha) {
    return buildEditorialOg({
      eyebrow: "Timeline",
      title: "Puxa Ficha",
      subtitle: buildTimelineOgFallbackSubtitle(),
    })
  }

  const n = buildTimelineEvents(ficha).length
  const countLabel = n === 1 ? "1 evento no eixo" : `${n} eventos no eixo`

  const partyLabel = formatPartyPublicLabel(ficha.partido_sigla)
  const cargoLabel = formatCargoDisputadoPublicLabel(ficha.cargo_disputado)
  return buildEditorialOg({
    eyebrow: partyLabel
      ? `Timeline · ${partyLabel} · ${cargoLabel}`
      : `Timeline · ${cargoLabel}`,
    title: ficha.nome_urna,
    subtitle: buildTimelineOgSubtitle(countLabel),
    meta: "Puxa Ficha · Linha do tempo",
  })
}
