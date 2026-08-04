import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getCandidatoMetadataResource } from "@/lib/api"
import { buildTwitterMetadata } from "@/lib/metadata"
import { formatPartyPublicLabel } from "@/lib/party-utils"
import { buildCandidateMetadataDescription } from "@/lib/ui-labels"
import { sanitizePtBrText } from "@/lib/ptbr-text"
import { CandidatoFichaView } from "./CandidatoFichaView"

// Esta rota foi `force-dynamic` por duas razões, e as duas caíram.
//
// A primeira era o RootLayout lendo `headers()` para o nonce de CSP, o que
// tornava TODA página do site dinâmica. Resolvido no PR #71: o nonce saiu do
// middleware e o layout não lê mais headers.
//
// A segunda era `getCandidatoBySlugResource` lendo `headers()` no bypass de
// release-verify, com as duas env vars ligadas em produção. Isso derrubou todas
// as fichas com 500 quando a rota virou estática (PR #70, revertido em
// `c0ef9a7`). O bypass foi removido; ficha fresca sob demanda agora se obtém
// com `POST /api/revalidate`, que passou a expirar de imediato.
//
// `searchParams.tab` não é lido no servidor; a aba inicial vinda de `?tab=` é
// resolvida no client por `CandidatoProfile`.
export const revalidate = 3600

/**
 * Medido nesta sessão: sem `generateStaticParams` o Next 16 mantém a rota
 * dinâmica e serve `private, no-store` mesmo com o `revalidate` acima. Ou seja,
 * este export não é enfeite, é ele que torna a ficha passível de cache.
 *
 * A lista é PROPOSITALMENTE vazia. Gerar as 253 fichas no build custaria ~13
 * queries cada (`fetchCandidatoCompleto`), mais de 3 mil queries por deploy
 * contra a cota de egress do plano Free do Supabase, e ameaçaria o teto de 180s
 * de `staticPageGenerationTimeout`. Com a lista vazia e `dynamicParams` no
 * default, cada ficha é gerada na primeira visita e servida do cache pela hora
 * seguinte: 1 render por ficha por hora em vez de 1 render por visita.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return []
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const candidatoResource = await getCandidatoMetadataResource(slug)
  const candidato = candidatoResource.data
  if (!candidato) {
    // Slug inexistente: notFound() aqui, em generateMetadata, produz HTTP 404
    // real antes do streaming do page body comitar status 200.
    if (candidatoResource.sourceStatus === "live") {
      notFound()
    }
    return {}
  }
  const desc = candidato.biografia
    ? sanitizePtBrText(candidato.biografia).slice(0, 155) + "..."
    : buildCandidateMetadataDescription(candidato.nome_urna, candidato.partido_sigla)
  const partyLabel = formatPartyPublicLabel(candidato.partido_sigla)
  const title = partyLabel
    ? `${candidato.nome_urna} (${partyLabel}) | Puxa Ficha`
    : `${candidato.nome_urna} | Puxa Ficha`

  return {
    title,
    description: desc,
    alternates: {
      canonical: `/candidato/${slug}`,
    },
    openGraph: {
      title,
      description: desc,
      url: `https://puxaficha.com.br/candidato/${slug}`,
      siteName: "Puxa Ficha",
      locale: "pt_BR",
      type: "profile",
      images: [
        {
          url: `/candidato/${slug}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `Ficha de ${candidato.nome_urna}`,
        },
      ],
    },
    twitter: buildTwitterMetadata({
      title,
      description: desc,
      image: `/candidato/${slug}/opengraph-image`,
    }),
  }
}

export default async function CandidatoPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // Bloco 7 do review 2026-04-24: aba inicial vinda de `?tab=` é resolvida no
  // client (`CandidatoProfile` lê `window.location.search` no mount). Não
  // lemos `searchParams` aqui para preservar SSG/ISR.
  return <CandidatoFichaView slug={slug} />
}
