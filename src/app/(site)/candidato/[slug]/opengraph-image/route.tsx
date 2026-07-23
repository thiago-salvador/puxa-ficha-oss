import { getCandidatoBySlugResource } from "@/lib/api"
import { buildEditorialOg } from "@/lib/og"
import { formatPartyPublicLabel } from "@/lib/party-utils"
import { formatCargoDisputadoPublicLabel } from "@/lib/ui-labels"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const ficha = (await getCandidatoBySlugResource(slug)).data

  if (!ficha) {
    return buildEditorialOg({
      eyebrow: "Ficha de candidato",
      title: "Puxa Ficha",
      subtitle:
        "Ficha pública de pré-candidato mapeado, com dados disponíveis e contexto editorial quando houver fonte estruturada.",
    })
  }

  const partyLabel = formatPartyPublicLabel(ficha.partido_sigla)
  const cargoLabel = formatCargoDisputadoPublicLabel(ficha.cargo_disputado)
  return buildEditorialOg({
    eyebrow: partyLabel ? `${partyLabel} · ${cargoLabel}` : cargoLabel,
    title: ficha.nome_urna,
    subtitle:
      ficha.biografia?.slice(0, 170) ??
      `Ficha pública de ${ficha.nome_urna} com dados disponíveis sobre patrimônio, processos, votações e financiamento quando houver fonte estruturada.`,
    meta: "Dados públicos · não é recomendação de voto",
  })
}
