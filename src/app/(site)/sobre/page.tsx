import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { SectionLabel, SectionTitle, SectionDivider } from "@/components/SectionHeader"
import { Footer } from "@/components/Footer"
import { buildTwitterMetadata } from "@/lib/metadata"

const title = "Sobre o projeto | Puxa Ficha"
const description =
  "Como funciona o Puxa Ficha, fontes de dados, metodologia e quem está por trás."

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: "/sobre",
  },
  openGraph: {
    title,
    description,
    url: "https://puxaficha.com.br/sobre",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Sobre o Puxa Ficha",
      },
    ],
  },
  twitter: buildTwitterMetadata({
    title,
    description,
    image: "/opengraph-image",
  }),
}

export default function SobrePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero banner */}
      <section className="relative overflow-hidden bg-black">
        <div className="absolute inset-0 opacity-40" aria-hidden="true">
          <Image
            src="/images/sobre-congresso.webp"
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/40" />
        <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-28 sm:pb-16 sm:pt-32 md:px-12 lg:pb-20 lg:pt-40">
          <p className="text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-white">
            Sobre
          </p>
          <h1
            className="mt-2 font-heading uppercase leading-[0.85] text-white"
            style={{ fontSize: "clamp(36px, 8vw, 80px)" }}
          >
            Puxa Ficha
          </h1>
        </div>
      </section>

      <div className="pt-8 sm:pt-12">
        <SectionDivider />
      </div>

      <section className="mx-auto max-w-7xl px-5 py-8 sm:py-12 md:px-12 lg:py-16">
        <div className="max-w-2xl space-y-5">
          <p className="text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[length:var(--text-body-lg)]">
            O Puxa Ficha é uma plataforma de consulta pública sobre pré-candidatos mapeados para
            2026. O objetivo é oferecer informações públicas disponíveis de forma acessível, com
            análise crítica e transparente.
          </p>
          <p className="text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[length:var(--text-body-lg)]">
            Diferente de ferramentas que simulam neutralidade, o Puxa Ficha tem uma perspectiva
            editorial explícita: linguagem acessível para a classe trabalhadora, foco em contradições
            entre discurso e prática, e transparência sobre critérios, limites e fontes.
          </p>
          <p className="text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[length:var(--text-body-lg)]">
            Nos perfis, alertas e destaques positivos exibem selos que indicam se o trecho foi escrito ou
            checado pela curadoria editorial, se envolveu IA ou se foi produzido por fluxo automático.
            O selo também indica se o trecho ainda aguarda verificação adicional, com links para fontes
            quando houver.
          </p>
        </div>
      </section>

      <SectionDivider />

      <section className="mx-auto max-w-7xl px-5 py-8 sm:py-12 md:px-12 lg:py-16">
        <SectionLabel>01 Fontes e Metodologia</SectionLabel>
        <SectionTitle>Como funciona</SectionTitle>
        <div className="mt-6 max-w-2xl space-y-5 sm:mt-8">
          <p className="text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[length:var(--text-body-lg)]">
            O Puxa Ficha organiza fontes públicas consultadas (TSE, Câmara, Senado, CGU, Wikipedia
            e outras) com rotinas automatizadas e checagens operacionais por fonte.
            Pontos de atenção e trechos editoriais exibem selos que indicam se já houve checagem
            editorial, se ainda há pendência de verificação ou se o trecho veio de fluxo automático.
            Pontos gerados por IA como alerta só entram na página pública após checagem editorial
            registrada no sistema. Isso não equivale a parecer jurídico nem a aprovação humana final.
          </p>
          <p className="text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[length:var(--text-body-lg)]">
            Para o detalhamento das fontes consultadas, frequência de atualização, pipeline de dados
            e indicadores de frescor, veja a{" "}
            <Link
              href="/metodologia"
              className="font-bold text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground/60"
            >
              página de metodologia
            </Link>
            . A metodologia da comparação do quiz está em{" "}
            <Link
              href="/quiz/metodologia"
              className="font-bold text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground/60"
            >
              Metodologia do quiz
            </Link>
            .
          </p>
        </div>
      </section>

      <SectionDivider />

      <section className="mx-auto max-w-7xl px-5 py-8 sm:py-12 md:px-12 lg:py-16">
        <SectionLabel>02 Autor</SectionLabel>
        <SectionTitle>Quem faz</SectionTitle>
        <p className="mt-6 max-w-2xl text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:mt-8 sm:text-[length:var(--text-body-lg)]">
          Projeto de{" "}
          <a
            href="https://instagram.com/salvador_thiago"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground/60"
          >
            Thiago Salvador
          </a>
          , criador de conteúdo sobre inteligência artificial e política.
        </p>
        <p className="mt-4 text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[length:var(--text-body-lg)]">
          Dúvidas, sugestões ou pedidos de correção podem ser enviados para{" "}
          <a
            href="mailto:contato@puxaficha.com.br"
            className="font-bold text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground/60"
          >
            contato@puxaficha.com.br
          </a>
          .
        </p>
        <p className="mt-4 max-w-2xl text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[length:var(--text-body-lg)]">
          Para retificar uma ficha pública, use esse canal e envie o link da ficha, o trecho
          questionado e a fonte oficial ou documento que sustenta a correção. Use o assunto{" "}
          <strong>Retificação de ficha</strong>. O pedido será analisado sem promessa de remoção
          automática de dados de interesse público.
        </p>
      </section>

      <Footer />
    </div>
  )
}
