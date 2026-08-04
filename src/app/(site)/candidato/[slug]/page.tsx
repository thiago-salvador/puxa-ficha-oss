import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getCandidatoMetadataResource } from "@/lib/api"
import { buildTwitterMetadata } from "@/lib/metadata"
import { formatPartyPublicLabel } from "@/lib/party-utils"
import { buildCandidateMetadataDescription } from "@/lib/ui-labels"
import { sanitizePtBrText } from "@/lib/ptbr-text"
import { CandidatoFichaView } from "./CandidatoFichaView"

// Bloco 7 do review 2026-04-24 exigia `force-dynamic` porque o RootLayout lia
// `headers()` para o nonce de CSP, e sem isso o pre-render disparava
// DYNAMIC_SERVER_USAGE. O nonce saiu (ver middleware.ts) e o layout nao le mais
// headers(), entao a ficha volta a ser ISR: o HTML passa a ser servido pelo CDN
// e cada view deixa de custar um render de funcao. Essa e a rota que um video
// viral concentra, entao e a que mais paga por estar em cache.
// `searchParams.tab` nao e lido no servidor; a aba inicial vinda de `?tab=` e
// resolvida no client por `CandidatoProfile`.
// O caminho de bypass do release-verify (`PF_ALLOW_RELEASE_VERIFY_CACHE_BYPASS_IN_PRODUCTION`
// + header `x-pf-release-verify-cache-bypass`) continua transformando o request em
// no-store so quando ativado, sem afetar o build.
export const revalidate = 3600

/**
 * Medido nesta sessao: sem `generateStaticParams` o Next 16 marca a rota como
 * `ƒ` e serve `cache-control: private, no-store`, mesmo com `revalidate`
 * declarado acima. Ou seja, a exportacao abaixo nao e enfeite: e ela que torna
 * a ficha cacheavel.
 *
 * A lista devolvida e PROPOSITALMENTE vazia. Prerenderizar os 253 slugs no
 * build custaria ~13 queries por ficha (`fetchCandidatoCompleto`), mais de 3 mil
 * queries a cada deploy contra a cota de egress do plano Free do Supabase, e
 * ameacaria o teto de 180s de `staticPageGenerationTimeout`. Com a lista vazia e
 * `dynamicParams` no default (true), nenhuma ficha e gerada no build e todas
 * passam a ser geradas sob demanda na primeira visita e servidas do cache pela
 * hora seguinte. O custo por ficha vira 1 render por hora em vez de 1 render por
 * visita, que e exatamente o que um pico de video precisa.
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
