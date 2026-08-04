import type { NextRequest } from "next/server"

// Origem usada pelo auto-encadeamento dos crons (news/refresh e send-digest).
//
// req.nextUrl.origin NAO serve em producao: o cron da Vercel invoca a funcao
// pela URL *.vercel.app do deployment, que fica atras do Vercel SSO. O fetch
// encadeado contra essa origem recebe 302 -> vercel.com/sso-api sem lancar
// excecao, entao o proximo lote nunca comeca e nenhum chain_fetch_failed
// aparece (incidente de 2026-08-04: news/refresh cobria 5 de 194 candidatos
// por dia respondendo 200).
//
// Mesmo padrao de origem canonica explicita da rota irma
// /api/internal/runtime-smoke (PF_RUNTIME_SMOKE_ORIGIN).
const CANONICAL_PRODUCTION_ORIGIN = "https://puxaficha.com.br"

export function resolveChainOrigin(req: NextRequest): string {
  const configured = process.env.PF_CRON_CHAIN_ORIGIN?.trim()
  if (configured) return configured
  // Preview tambem roda atras do SSO, mas encadear preview -> producao seria
  // pior que nao encadear: o fallback canonico fica restrito a producao.
  if (process.env.VERCEL_ENV === "production") return CANONICAL_PRODUCTION_ORIGIN
  return req.nextUrl.origin
}
