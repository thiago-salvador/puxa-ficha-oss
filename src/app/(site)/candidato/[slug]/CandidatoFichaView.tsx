import { notFound } from "next/navigation"
import Link from "next/link"
import {
  getCandidatoBySlugResource,
  getCandidatoNavResource,
  mergeSourceMessages,
  mergeSourceStatuses,
} from "@/lib/api"
import { SITE_ORIGIN } from "@/lib/metadata"
import type { CandidatoProfileTabId } from "@/lib/candidato-profile-tabs"
import { SectionDivider } from "@/components/SectionHeader"
import { Footer } from "@/components/Footer"
import { CandidatePhoto } from "@/components/CandidatePhoto"
import { DeferredCandidatoProfile } from "@/components/DeferredCandidatoProfile"
import {
  DeferredFollowCandidateButton,
  DeferredRecordGlobalSearchRecentVisit,
  DeferredShareButtons,
} from "@/components/DeferredCandidateClientWidgets"
import { SocialLinks } from "@/components/SocialLinks"
import { DataSourceNotice } from "@/components/DataSourceNotice"
import { DataUnavailableState } from "@/components/DataUnavailableState"
import { ProfileSourceFooter } from "@/components/ProfileSourceFooter"
import { JsonLd } from "@/components/JsonLd"
import {
  buildCandidateMetadataDescription,
  buildCandidateShareTitle,
  buildTimelineMetadataDescription,
  formatCargoDisputadoPublicLabel,
} from "@/lib/ui-labels"
import { formatPartyPublicLabel } from "@/lib/party-utils"
import { sanitizePtBrText } from "@/lib/ptbr-text"
import { ArrowLeft, ArrowRight } from "lucide-react"

const getFicha = (slug: string) => getCandidatoBySlugResource(slug)

export interface CandidatoFichaViewProps {
  slug: string
  profileInitialTab?: CandidatoProfileTabId
  /**
   * Quando `timeline`, JSON-LD e URL do ProfilePage apontam para a sub-rota da timeline
   * (compartilhamento e crawlers).
   */
  seoSubpath?: "timeline"
}

export async function CandidatoFichaView({
  slug,
  profileInitialTab,
  seoSubpath,
}: CandidatoFichaViewProps) {
  const fichaResource = await getFicha(slug)
  const ficha = fichaResource.data
  if (!ficha) {
    if (fichaResource.sourceStatus === "degraded") {
      return (
        <div className="min-h-screen bg-background">
          <div className="mx-auto max-w-7xl px-5 pt-20 md:px-12">
            <DataUnavailableState
              title="Ficha temporariamente indisponível"
              description={fichaResource.sourceMessage ?? undefined}
            />
          </div>
          <Footer />
        </div>
      )
    }
    notFound()
  }

  const allCandidatosResource = await getCandidatoNavResource(ficha.cargo_disputado)
  const allCandidatos = allCandidatosResource.data
  const sourceStatus = mergeSourceStatuses(
    fichaResource.sourceStatus,
    allCandidatosResource.sourceStatus,
  )
  const sourceMessage = mergeSourceMessages(
    fichaResource.sourceMessage,
    allCandidatosResource.sourceMessage,
  )
  const sorted = [...allCandidatos].sort((a, b) => a.nome_urna.localeCompare(b.nome_urna, "pt-BR"))
  const currentIdx = sorted.findIndex((c) => c.slug === slug)
  const prev = currentIdx > 0 ? sorted[currentIdx - 1] : null
  const next = currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null

  const isUfScopedStateProfile =
    Boolean(ficha.estado) &&
    (ficha.cargo_disputado === "Governador" || ficha.cargo_disputado === "Nenhum")
  const backHref =
    isUfScopedStateProfile && ficha.estado ? `/uf/${ficha.estado.toLowerCase()}` : "/"
  const backLabel =
    isUfScopedStateProfile && ficha.estado ? `Estado ${ficha.estado.toUpperCase()}` : "Candidatos"

  const fichaUrl = `${SITE_ORIGIN}/candidato/${slug}`
  const timelineUrl = `${SITE_ORIGIN}/candidato/${slug}/timeline`
  // Sanitizacao publica de partido_sigla/partido_atual ja acontece no resource
  // central (src/lib/api.ts via sanitizePublicPartyFields). Ficha aqui ja chega
  // com partido publico (canonicalizado ou null para incerto), entao o mapping
  // pontual `fichaForPublicDisplay` que existia ate o Bloco 1 foi removido.
  // formatPartyPublicLabel ainda e usado abaixo para texto visivel (eyebrow,
  // JSON-LD name) onde precisamos garantir string vazia em vez de null.
  const partyPublicLabel = formatPartyPublicLabel(ficha.partido_sigla)
  const shareTitle = buildCandidateShareTitle(ficha.nome_urna, ficha.partido_sigla)
  const hasSocialLinks = Object.keys(ficha.redes_sociais ?? {}).length > 0 || Boolean(ficha.site_campanha)

  const schema =
    seoSubpath === "timeline"
      ? [
          {
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            name: partyPublicLabel
              ? `Linha do tempo · ${ficha.nome_urna} (${partyPublicLabel})`
              : `Linha do tempo · ${ficha.nome_urna}`,
            url: timelineUrl,
            description: buildTimelineMetadataDescription(ficha.nome_urna),
            mainEntity: {
              "@type": "Person",
              name: ficha.nome_urna,
              alternateName: ficha.nome_completo,
              image: ficha.foto_url ?? undefined,
              jobTitle: formatCargoDisputadoPublicLabel(ficha.cargo_disputado),
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Início",
                item: SITE_ORIGIN,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: ficha.nome_urna,
                item: fichaUrl,
              },
              {
                "@type": "ListItem",
                position: 3,
                name: "Linha do tempo",
                item: timelineUrl,
              },
            ],
          },
        ]
      : [
          {
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            name: partyPublicLabel
              ? `${ficha.nome_urna} (${partyPublicLabel})`
              : ficha.nome_urna,
            url: fichaUrl,
            description: ficha.biografia ?? buildCandidateMetadataDescription(ficha.nome_urna, ficha.partido_sigla),
            mainEntity: {
              "@type": "Person",
              name: ficha.nome_urna,
              alternateName: ficha.nome_completo,
              image: ficha.foto_url ?? undefined,
              jobTitle: formatCargoDisputadoPublicLabel(ficha.cargo_disputado),
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Início",
                item: SITE_ORIGIN,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: ficha.nome_urna,
                item: fichaUrl,
              },
            ],
          },
        ]

  const fichaSearchSubtitle = [
    partyPublicLabel || null,
    ficha.cargo_atual
      ? sanitizePtBrText(ficha.cargo_atual)
      : ficha.cargo_disputado
        ? formatCargoDisputadoPublicLabel(ficha.cargo_disputado)
        : null,
    ficha.estado,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="min-h-screen bg-background">
      <JsonLd data={schema} />
      <DeferredRecordGlobalSearchRecentVisit
        href={`/candidato/${slug}`}
        title={ficha.nome_urna}
        subtitle={fichaSearchSubtitle}
        foto_url={ficha.foto_url}
      />
      <div className="mx-auto max-w-7xl px-5 pt-20 sm:pt-24 md:px-12">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.08em] text-foreground transition-colors hover:text-foreground sm:text-[length:var(--text-caption)]"
        >
          <ArrowLeft className="size-3 sm:size-3.5" />
          {backLabel}
        </Link>
      </div>

      <section
        data-pf-hero
        className="mx-auto max-w-7xl px-5 pt-6 pb-6 sm:pt-8 sm:pb-8 md:px-12"
      >
        <div className="flex flex-col gap-6 sm:gap-8 lg:flex-row lg:items-center lg:gap-12">
          {ficha.foto_url && (
            <div className="shrink-0 self-start">
              <CandidatePhoto
                src={ficha.foto_url}
                alt={`Foto de ${ficha.nome_urna}`}
                name={ficha.nome_urna}
                width={315}
                height={420}
                sizes="(max-width: 1024px) 270px, 315px"
                priority
                fetchPriority="high"
                className="hidden object-cover object-top sm:block sm:h-[360px] sm:w-[270px] sm:rounded-[20px] lg:h-[420px] lg:w-[315px]"
                fallbackClassName="hidden sm:flex sm:h-[360px] sm:w-[270px] sm:rounded-[20px] lg:h-[420px] lg:w-[315px]"
                initialsClassName="text-6xl"
              />
            </div>
          )}

          <div className="flex flex-col justify-end">
            <span
              data-pf-hero-party={partyPublicLabel || undefined}
              data-pf-hero-role={ficha.cargo_disputado}
              className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground sm:text-[length:var(--text-eyebrow)]"
            >
              {partyPublicLabel
                ? `${partyPublicLabel} · ${formatCargoDisputadoPublicLabel(ficha.cargo_disputado)}`
                : formatCargoDisputadoPublicLabel(ficha.cargo_disputado)}
            </span>

            <h1
              data-pf-hero-name
              className="mt-1.5 font-heading uppercase leading-[0.85] tracking-[-0.02em] text-foreground sm:mt-2"
              style={{ fontSize: "clamp(36px, 8vw, 80px)" }}
            >
              {ficha.nome_urna}
            </h1>

            {ficha.nome_completo !== ficha.nome_urna && (
              <p className="mt-1.5 text-[length:var(--text-body-sm)] font-medium text-foreground sm:mt-2 sm:text-[length:var(--text-body)]">
                {ficha.nome_completo}
              </p>
            )}

            <p
              data-pf-hero-meta
              className="mt-2 hidden text-[length:var(--text-caption)] font-semibold text-muted-foreground sm:mt-3 sm:block sm:text-[length:var(--text-body-sm)]"
            >
              {[
                ficha.cargo_atual ? sanitizePtBrText(ficha.cargo_atual) : null,
                ficha.naturalidade,
                ficha.idade ? `${ficha.idade} anos` : null,
                ficha.formacao ? sanitizePtBrText(ficha.formacao) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {ficha.biografia && (
              <p
                data-pf-bio
                className="mt-4 hidden max-w-2xl text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:mt-5 sm:block sm:text-[15px]"
              >
                {sanitizePtBrText(ficha.biografia)}
              </p>
            )}
            <div className="mt-4 space-y-3">
              {hasSocialLinks && (
                <SocialLinks redes={ficha.redes_sociais ?? {}} site={ficha.site_campanha} />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <DeferredShareButtons
                  shareUrl={fichaUrl}
                  title={shareTitle}
                  label="Compartilhar perfil"
                  variant="compact"
                  slug={slug}
                  candidateName={ficha.nome_urna}
                />
                <DeferredFollowCandidateButton
                  candidateName={ficha.nome_urna}
                  candidateSlug={ficha.slug}
                  variant="compact"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-5 pb-2 md:px-12">
        <DataSourceNotice status={sourceStatus} message={sourceMessage} />
      </div>

      <SectionDivider />

      <ProfileSourceFooter ficha={ficha} />

      <DeferredCandidatoProfile ficha={ficha} initialTab={profileInitialTab} />

      {ficha.biografia && (
        <section className="mx-auto max-w-7xl px-5 py-6 sm:hidden">
          <p className="text-[length:var(--text-body-sm)] font-medium leading-relaxed text-foreground">
            {sanitizePtBrText(ficha.biografia)}
          </p>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-12">
        <DeferredShareButtons
          shareUrl={fichaUrl}
          title={shareTitle}
          label="Compartilhar ficha"
          slug={slug}
          candidateName={ficha.nome_urna}
        />
      </section>

      {(prev || next) && (
        <>
          <SectionDivider />
          <nav aria-label="Navegação entre candidatos" className="mx-auto max-w-7xl px-5 py-8 md:px-12">
            <div className="flex items-center justify-between">
              {prev ? (
                <Link
                  href={`/candidato/${prev.slug}`}
                  className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
                  <div>
                    <span className="block text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.08em]">
                      Anterior
                    </span>
                    <span className="block font-heading text-lg uppercase text-foreground">
                      {prev.nome_urna}
                    </span>
                  </div>
                </Link>
              ) : (
                <div />
              )}
              {next ? (
                <Link
                  href={`/candidato/${next.slug}`}
                  className="group flex items-center gap-2 text-right text-muted-foreground transition-colors hover:text-foreground"
                >
                  <div>
                    <span className="block text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.08em]">
                      Próximo
                    </span>
                    <span className="block font-heading text-lg uppercase text-foreground">
                      {next.nome_urna}
                    </span>
                  </div>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              ) : (
                <div />
              )}
            </div>
          </nav>
        </>
      )}

      <Footer />
    </div>
  )
}
