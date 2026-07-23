import type { Metadata } from "next"
import Link from "next/link"
import { Footer } from "@/components/Footer"
import { QuizLanding } from "@/components/quiz/QuizLanding"
import { buildAbsoluteUrl, buildTwitterMetadata } from "@/lib/metadata"

const title = "Quem me representa? | Puxa Ficha"
const description =
  "Quiz de comparação programática com pré-candidatos: votações no Congresso, posições declaradas, projetos, financiamento e espectro partidário. Sem ranking ou recomendação de voto."
const image = buildAbsoluteUrl("/quiz/resultado/og")

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/quiz" },
  openGraph: {
    title,
    description,
    url: "https://puxaficha.com.br/quiz",
    type: "website",
    images: [
      {
        url: image,
        width: 1200,
        height: 630,
        alt: "Quem me representa? | Puxa Ficha",
      },
    ],
  },
  twitter: buildTwitterMetadata({ title, description, image }),
}

export const revalidate = 3600

export default function QuizPage() {
  return (
    <div className="min-h-screen bg-background pt-16">
      <header className="border-b border-border px-4 py-4">
        <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          Voltar ao início
        </Link>
      </header>
      <QuizLanding />
      <Footer />
    </div>
  )
}
