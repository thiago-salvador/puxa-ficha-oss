import {
  getCandidatosComResumoResource,
  getCandidatosComparaveisResource,
  mergeSourceMessages,
  mergeSourceStatuses,
} from "@/lib/api"
import Link from "next/link"
import { Suspense, lazy } from "react"
import { DeferredCandidatoGrid } from "@/components/DeferredCandidatoGrid"

const ComparadorPanel = lazy(() =>
  import("@/components/ComparadorPanel").then((m) => ({ default: m.ComparadorPanel })),
)
import { SlashDivider } from "@/components/SlashDivider"
import { Footer } from "@/components/Footer"
import { DataSourceNotice } from "@/components/DataSourceNotice"
import { PublicDataSourcesNote } from "@/components/PublicDataSourcesNote"
import { JsonLd } from "@/components/JsonLd"
import { formatBRL } from "@/lib/utils"

export const revalidate = 3600

export default async function Home() {
  const [resumosResource, comparaveisResource] = await Promise.all([
    getCandidatosComResumoResource("Presidente"),
    getCandidatosComparaveisResource("Presidente"),
  ])
  const resumos = resumosResource.data
  const comparaveis = comparaveisResource.data
  const sourceStatus = mergeSourceStatuses(
    resumosResource.sourceStatus,
    comparaveisResource.sourceStatus
  )
  const sourceMessage = mergeSourceMessages(
    resumosResource.sourceMessage,
    comparaveisResource.sourceMessage
  )

  resumos.sort((a, b) =>
    a.candidato.nome_urna.localeCompare(b.candidato.nome_urna, "pt-BR")
  )

  const candidatos = resumos.map((r) => r.candidato)
  const processos: Record<string, number> = {}
  const patrimonios: Record<string, number | null> = {}
  for (const r of resumos) {
    processos[r.candidato.slug] = r.processos
    patrimonios[r.candidato.slug] = r.patrimonio
  }

  // Aggregate stats for hero data bar
  const totalCandidatos = candidatos.length
  const totalPatrimonio = resumos.reduce(
    (sum, r) => sum + (r.patrimonio ?? 0),
    0
  )
  const totalProcessos = resumos.reduce((sum, r) => sum + r.processos, 0)
  const schema = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Puxa Ficha",
      url: "https://puxaficha.com.br",
      description:
        "Consulta pública sobre pré-candidatos mapeados para 2026, com ficha pública, comparador e contexto editorial baseado em fontes disponíveis.",
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Pré-candidatos à Presidência 2026",
      itemListElement: candidatos.slice(0, 12).map((candidato, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `https://puxaficha.com.br/candidato/${candidato.slug}`,
        name: candidato.nome_urna,
      })),
    },
  ]

  return (
    <div className="min-h-screen bg-background">
      <JsonLd data={schema} />
      {/* Hero — dossiê image background */}
      <section className="relative overflow-hidden bg-black">
        {/* Background image */}
        <div className="absolute inset-0 opacity-40" aria-hidden="true">
          <picture>
            <source media="(max-width: 640px)" srcSet="/images/hero-dossie-mobile.webp" />
            <img
              src="/images/hero-dossie.webp"
              srcSet="/images/hero-dossie-mobile.webp 560w, /images/hero-dossie.webp 1600w"
              sizes="100vw"
              alt=""
              fetchPriority="high"
              decoding="async"
              width={1600}
              height={893}
              className="h-full w-full object-cover"
            />
          </picture>
        </div>
        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/50" />

        <div className="relative mx-auto max-w-7xl px-5 pb-14 pt-28 sm:pb-20 sm:pt-32 md:px-12 lg:pb-24 lg:pt-40">
          {/* Massive title */}
          <h1
            className="hero-fade font-heading uppercase leading-[0.85] tracking-[-0.02em] text-white"
            style={{ fontSize: "calc(min(31vw, 200px))", animationDelay: "0.1s" }}
          >
            Puxa Ficha
          </h1>

          {/* Slash divider */}
          <SlashDivider className="hero-fade my-6 lg:my-8" color="text-white" />

          {/* Label */}
          <p className="hero-fade text-[11px] font-semibold uppercase tracking-[0.15em] text-white" style={{ animationDelay: "0.3s" }}>
            Eleições 2026
          </p>

          {/* Data bar */}
          <div className="mt-6 flex flex-wrap gap-6 pb-4 sm:gap-12 lg:gap-20">
            <div className="hero-fade" style={{ animationDelay: "0.4s" }}>
              <p className="font-heading text-[22px] leading-none tracking-tight text-white sm:text-[36px] lg:text-[48px]">
                {totalCandidatos}
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                pré-candidatos mapeados
              </p>
            </div>
            {totalPatrimonio > 0 && (
              <div className="hero-fade" style={{ animationDelay: "0.5s" }}>
                <p className="font-heading text-[22px] leading-none tracking-tight text-white sm:text-[36px] lg:text-[48px]">
                  {totalPatrimonio >= 1_000_000
                    ? `R$ ${(totalPatrimonio / 1_000_000).toFixed(0)}M`
                    : formatBRL(totalPatrimonio)}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                  patrimônio declarado
                </p>
              </div>
            )}
            {totalProcessos > 0 && (
              <div className="hero-fade" style={{ animationDelay: "0.6s" }}>
                <p className="font-heading text-[22px] leading-none tracking-tight text-white sm:text-[36px] lg:text-[48px]">
                  {totalProcessos}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                  processos
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pt-6 md:px-12">
        <DataSourceNotice status={sourceStatus} message={sourceMessage} />
      </section>

      <section className="mx-auto max-w-7xl px-5 pt-8 md:px-12 lg:pt-10">
        <div className="max-w-3xl">
          <p className="text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[15px]">
            O Puxa Ficha organiza fontes públicas consultadas, como TSE,
            Câmara e Senado, para ajudar quem busca entender nomes já mapeados
            para 2026 antes do período eleitoral endurecer a propaganda.
          </p>
          <p className="mt-3 text-[length:var(--text-body)] font-medium leading-relaxed text-muted-foreground sm:text-[15px]">
            Aqui você encontra ficha pública, comparação lado a lado e uma
            navegação mais rápida por nome, partido e estado. Se quiser atalhos
            imediatos, você pode ir para{" "}
            <Link href="/comparar" className="font-semibold text-foreground underline">
              comparar
            </Link>

            {" "}ou abrir o mapa de{" "}
            <Link href="/governadores" className="font-semibold text-foreground underline">
              governadores
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Section header */}
      <section className="mx-auto max-w-7xl px-5 pt-12 sm:pt-16 md:px-12 lg:pt-20">
        <div className="section-reveal flex items-end justify-between">
          <div>
            <p className="text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-foreground">
              01 Presidência
            </p>
            <h2
              className="mt-1 font-heading uppercase leading-[0.95] text-foreground"
              style={{ fontSize: "clamp(28px, 5vw, 48px)" }}
            >
              Presidenciáveis
            </h2>
          </div>
          <Link
            href="/governadores"
            className="font-heading uppercase leading-[0.95] text-muted-foreground transition-colors hover:text-foreground"
            style={{ fontSize: "clamp(28px, 5vw, 48px)" }}
          >
            Governadores
          </Link>
        </div>
        <SlashDivider className="mt-6 mb-8 sm:mt-8 sm:mb-10" />
      </section>

      {/* Candidate grid */}
      <section className="mx-auto max-w-7xl px-5 pb-16 md:px-12 lg:pb-20">
        <DeferredCandidatoGrid
          candidatos={candidatos}
          processos={processos}
          patrimonios={patrimonios}
        />
      </section>

      {/* Quiz CTA */}
      <div className="mx-auto max-w-7xl px-5 md:px-12">
        <SlashDivider />
      </div>
      <section className="mx-auto max-w-7xl px-5 pt-12 sm:pt-16 md:px-12 lg:pt-20">
        <div className="section-reveal">
          <p className="text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-foreground">
            02 Quiz
          </p>
          <h2
            className="mt-1 font-heading uppercase leading-[0.95] text-foreground"
            style={{ fontSize: "clamp(28px, 5vw, 48px)" }}
          >
            Compare sinais programáticos
          </h2>
        </div>
        <SlashDivider className="mt-6 mb-8 sm:mt-8 sm:mb-10" />
        <div className="max-w-2xl pb-16 lg:pb-20">
          <p className="text-[length:var(--text-body)] font-medium leading-relaxed text-muted-foreground sm:text-[15px]">
            Responda algumas perguntas sobre temas como economia, segurança e
            meio ambiente e veja uma comparação programática, sem recomendação
            de voto.
          </p>
          <Link
            href="/quiz"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-foreground px-6 py-3 text-sm font-semibold uppercase tracking-wide text-background transition-opacity hover:opacity-80"
          >
            Fazer o quiz
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </section>

      {/* Comparador */}
      {comparaveis.length >= 2 && (
        <>
          <div className="mx-auto max-w-7xl px-5 md:px-12">
            <SlashDivider />
          </div>
          <section className="mx-auto max-w-7xl px-5 pt-12 sm:pt-16 md:px-12 lg:pt-20">
            <div className="section-reveal">
              <p className="text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-foreground">
                03 Comparador
              </p>
              <h2
                className="mt-1 font-heading uppercase leading-[0.95] text-foreground"
                style={{ fontSize: "clamp(28px, 5vw, 48px)" }}
              >
                Lado a lado
              </h2>
            </div>
            <SlashDivider className="mt-6 mb-8 sm:mt-8 sm:mb-10" />
          </section>
          <Suspense fallback={<div className="mx-auto max-w-7xl px-5 md:px-12"><div className="h-96 animate-pulse rounded-xl bg-muted" /></div>}>
            <ComparadorPanel candidatos={comparaveis} />
          </Suspense>
        </>
      )}

      <section className="mx-auto max-w-7xl px-5 py-10 md:px-12 lg:py-14">
        <PublicDataSourcesNote variant="presidencia" />
      </section>

      <Footer />
    </div>
  )
}
