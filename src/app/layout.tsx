import type { Metadata } from "next"
import { Inter, Anton } from "next/font/google"
import { SITE_URL } from "@/lib/metadata"
import { getPreviewMetadataRobots } from "@/lib/preview-indexing"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
})

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  robots: getPreviewMetadataRobots(),
}

// Sem `await headers()` aqui de propósito. Este layout embrulha TODA rota do
// site, então ler headers() tornava cada página dinâmica e anulava os
// `export const revalidate` das 12 páginas públicas: o build marcava tudo como
// `ƒ` e a produção respondia `cache-control: private, no-store` com
// `x-vercel-cache: MISS` em 100% dos HTML. O nonce de CSP que justificava a
// leitura saiu do middleware (ver middleware.ts): a página não tem script
// inline, então `script-src 'self'` já barra injeção sem precisar de nonce.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${anton.variable}`}>
      <head>
        <link rel="preconnect" href="https://upload.wikimedia.org" crossOrigin="" />
        <noscript>
          {/* Intencional: só o navegador sem JS deve revelar os chunks SSR do React. */}
          {/* eslint-disable-next-line @next/next/no-css-tags */}
          <link rel="stylesheet" href="/no-js.css" />
        </noscript>
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  )
}
