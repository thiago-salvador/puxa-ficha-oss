import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { resolveEstadoUf } from "@/lib/br-uf"
import { buildContentSecurityPolicy } from "@/lib/content-security-policy"
import { getRankingDefinitionBySlug } from "@/data/ranking-definitions"

const INTERNAL_COOKIE_NAME = "pf_internal_token"
const PREVIEW_COOKIE_NAME = "pf_preview_token"
const MIN_PRODUCTION_INTERNAL_TOKEN_LENGTH = 24
const MIN_PRODUCTION_PREVIEW_TOKEN_LENGTH = 24
const applyProductionHttpsHeaders =
  process.env.VERCEL === "1" || process.env.PF_FORCE_PRODUCTION_SECURITY_HEADERS === "1"

function frameAncestorsForPath(pathname: string): "'none'" | "*" {
  return pathname === "/embed" || pathname.startsWith("/embed/") ? "*" : "'none'"
}

/**
 * CSP sem nonce, de proposito.
 *
 * O nonce era gerado por request e injetado como `x-nonce`; para o Next aplicar
 * o nonce aos scripts do framework, o RootLayout precisava ler `headers()`, o
 * que tornava TODA rota dinamica. Custo medido em producao: 100% dos HTML
 * saindo `cache-control: private, no-store` com `x-vercel-cache: MISS`, e o
 * build marcando as 12 paginas com `export const revalidate` como `ƒ`.
 *
 * O que se perde e pequeno: a pagina nao emite nenhum script inline (os 55
 * scripts do HTML sao `<script src="/_next/static/chunks/...">`, de mesma
 * origem e gerados no build). `script-src 'self'` SEM `'unsafe-inline'` ja
 * bloqueia qualquer script inline injetado. O nonce mais `'strict-dynamic'`
 * so acrescentava defesa contra injecao de `<script src>` apontando para um
 * caminho da propria origem, e este site nao serve conteudo de terceiro no
 * proprio dominio.
 */
function contentSecurityPolicyForRequest(request: NextRequest): string {
  return buildContentSecurityPolicy({
    frameAncestors: frameAncestorsForPath(request.nextUrl.pathname),
    applyProductionHttpsHeaders,
  })
}

function withContentSecurityPolicy(request: NextRequest, response: Response): Response {
  response.headers.set("Content-Security-Policy", contentSecurityPolicyForRequest(request))
  return response
}

function nextWithContentSecurityPolicy(request: NextRequest) {
  const response = NextResponse.next()
  response.headers.set("Content-Security-Policy", contentSecurityPolicyForRequest(request))
  return response
}

function notFoundResponse() {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  })
}

const CANDIDATO_NOT_FOUND_BODY = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>404 - Candidato nao encontrado - Puxa Ficha</title>
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fafafa;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
.wrap{max-width:640px}
h1{font-size:clamp(4rem,15vw,9rem);margin:0;letter-spacing:-0.02em;line-height:0.9;text-transform:uppercase}
p{color:#a3a3a3;font-size:1rem;margin:1.5rem 0 0}
a{display:inline-block;margin-top:2rem;color:#fafafa;text-decoration:none;border:1px solid #fafafa;padding:0.6rem 1.2rem;border-radius:9999px;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em}
a:hover{opacity:0.7}
</style>
</head>
<body>
<main class="wrap">
<h1>404</h1>
<p>Candidato nao encontrado. O slug informado nao corresponde a nenhuma ficha publica.</p>
<a href="/">Voltar para a home</a>
</main>
</body>
</html>`

function candidatoNotFoundResponse() {
  return new NextResponse(CANDIDATO_NOT_FOUND_BODY, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
      "x-robots-tag": "noindex, nofollow",
    },
  })
}

const CANDIDATO_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/

async function isValidCandidatoSlug(request: NextRequest, slug: string): Promise<boolean> {
  if (!CANDIDATO_SLUG_PATTERN.test(slug) || slug.length > 80) {
    return false
  }
  try {
    const url = new URL("/api/candidato-slugs", request.nextUrl.origin)
    // Sem `next: { revalidate, tags }` de proposito. Dentro do middleware essas
    // duas opcoes NAO fazem nada: o Next monta um work unit store do tipo
    // `request`, e o fetch instrumentado so acumula tag e revalidate quando o
    // store e de cache ou de prerender (packages/next/src/server/lib/patch-fetch.ts).
    // Sem config explicita de fetchCache, o mesmo arquivo ainda liga
    // `autoNoCache`. Ou seja: nao havia cache de Data Cache aqui para 300s
    // governar, e `revalidateTag("public-candidatos")` nunca alcancou esta
    // chamada. Ter as opcoes escritas dava a impressao contraria.
    //
    // A frescura real vem de duas coisas, as duas continuam valendo:
    //   1. o `cache-control` da propria resposta
    //      (`s-maxage=300, stale-while-revalidate=600`), respeitado pelo CDN,
    //      que e quem atende esta chamada;
    //   2. o `export const revalidate = 300` da rota, que governa o ISR dela.
    const res = await fetch(url, {
      headers: { "x-middleware-internal": "candidato-slugs" },
    })
    if (!res.ok) {
      // Fail-open: se o endpoint interno falhou, deixa o page render decidir.
      // Isso evita que um incidente no Supabase transforme todo mundo em 404.
      return true
    }
    const payload = (await res.json()) as { slugs?: unknown }
    // Fail-open tambem em lista vazia: uma leitura falha/degradada nunca pode
    // 404-ar toda ficha. Lista legitimamente vazia => nao ha /candidato/* mesmo,
    // e o page render emite o proprio 404 (review 2026-06-09).
    if (!Array.isArray(payload.slugs) || payload.slugs.length === 0) return true
    return payload.slugs.includes(slug)
  } catch {
    return true
  }
}

async function guardCandidatoRoute(request: NextRequest): Promise<NextResponse | null> {
  const segments = request.nextUrl.pathname.split("/")
  // ["", "candidato", "<slug>", ...optional subpath]
  const slugSegment = segments[2]
  if (!slugSegment) return null

  const slug = decodeURIComponent(slugSegment)
  const isValid = await isValidCandidatoSlug(request, slug)
  if (!isValid) return candidatoNotFoundResponse()
  return null
}

function buildSoftNotFoundResponse(title: string, message: string) {
  const body = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>404 - ${title} - Puxa Ficha</title>
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fafafa;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
.wrap{max-width:640px}
h1{font-size:clamp(4rem,15vw,9rem);margin:0;letter-spacing:-0.02em;line-height:0.9;text-transform:uppercase}
p{color:#a3a3a3;font-size:1rem;margin:1.5rem 0 0}
a{display:inline-block;margin-top:2rem;color:#fafafa;text-decoration:none;border:1px solid #fafafa;padding:0.6rem 1.2rem;border-radius:9999px;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em}
a:hover{opacity:0.7}
</style>
</head>
<body>
<main class="wrap">
<h1>404</h1>
<p>${message}</p>
<a href="/">Voltar para a home</a>
</main>
</body>
</html>`
  return new NextResponse(body, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
      "x-robots-tag": "noindex, nofollow",
    },
  })
}

function guardRankingRoute(request: NextRequest): NextResponse | null {
  const segments = request.nextUrl.pathname.split("/")
  // ["", "rankings"] (listing page) ou ["", "rankings", "<slug>", ...]
  const slugSegment = segments[2]
  if (!slugSegment) return null // /rankings (listing) passa direto
  const slug = decodeURIComponent(slugSegment)
  if (getRankingDefinitionBySlug(slug)) return null
  return buildSoftNotFoundResponse(
    "Ranking nao encontrado",
    "Ranking nao encontrado. O slug informado nao corresponde a nenhuma lista publica.",
  )
}

function guardUfRoute(request: NextRequest): NextResponse | null {
  const segments = request.nextUrl.pathname.split("/")
  // ["", "uf", "<uf>", ...]
  const ufSegment = segments[2]
  if (!ufSegment) return null
  const uf = decodeURIComponent(ufSegment)
  if (resolveEstadoUf(uf)) return null
  return buildSoftNotFoundResponse(
    "UF nao encontrada",
    "UF nao encontrada. Use a sigla de duas letras do estado brasileiro (ex.: sp, rj, mg).",
  )
}

function buildCleanRedirect(request: NextRequest) {
  const cleanUrl = request.nextUrl.clone()
  cleanUrl.searchParams.delete("token")
  return NextResponse.redirect(cleanUrl)
}

/**
 * Comparação constante (runtime-agnóstica, sem node:crypto porque o middleware
 * roda no edge). Evita o timing side-channel do `===` na verificação de token.
 * Percorre até o maior comprimento e acumula diferenças por XOR; vaza igualdade
 * de comprimento, nunca o conteúdo.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

function hasBootstrapToken(request: NextRequest, expectedToken: string) {
  const queryToken = request.nextUrl.searchParams.get("token")
  return Boolean(queryToken && constantTimeEqual(queryToken, expectedToken))
}

function hasCookieToken(request: NextRequest, cookieName: string, expectedToken: string) {
  const cookieToken = request.cookies.get(cookieName)?.value
  return Boolean(cookieToken && constantTimeEqual(cookieToken, expectedToken))
}

function setAccessCookie(response: NextResponse, name: string, value: string, path: string) {
  response.cookies.set({
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    path,
  })
}

function resolvePreviewToken() {
  const configuredToken = process.env.PF_PREVIEW_TOKEN?.trim()

  // Qualquer ambiente DEPLOYADO na Vercel (production E preview) exige token forte
  // configurado, fail-closed. /preview/* le candidatos NAO publicados via service
  // role (bypassa RLS), entao o fallback "local-preview" so pode existir em dev
  // local fora da Vercel (review 2026-06-09).
  const isDeployed =
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview"
  if (isDeployed) {
    if (!configuredToken || configuredToken.length < MIN_PRODUCTION_PREVIEW_TOKEN_LENGTH) {
      return null
    }
    return configuredToken
  }

  // Dev local (nao deployado): aceita token configurado ou o fallback de conveniencia.
  if (configuredToken) return configuredToken
  return "local-preview"
}

function resolveInternalToken() {
  const configuredToken = process.env.PF_INTERNAL_TOKEN?.trim()

  if (process.env.VERCEL_ENV === "production") {
    if (!configuredToken || configuredToken.length < MIN_PRODUCTION_INTERNAL_TOKEN_LENGTH) {
      return null
    }
    return configuredToken
  }

  return configuredToken || null
}

function protectInternalRoute(request: NextRequest): NextResponse | Response | null {
  if (process.env.NODE_ENV === "development") {
    return null
  }

  const expectedToken = resolveInternalToken()
  if (!expectedToken) {
    return notFoundResponse()
  }

  if (hasCookieToken(request, INTERNAL_COOKIE_NAME, expectedToken)) {
    if (request.nextUrl.searchParams.has("token")) {
      const response = buildCleanRedirect(request)
      setAccessCookie(response, INTERNAL_COOKIE_NAME, expectedToken, "/")
      return response
    }

    return null
  }

  if (!hasBootstrapToken(request, expectedToken)) {
    return notFoundResponse()
  }

  const response = buildCleanRedirect(request)
  setAccessCookie(response, INTERNAL_COOKIE_NAME, expectedToken, "/")
  return response
}

function protectPreviewRoute(request: NextRequest): NextResponse | Response | null {
  const expectedToken = resolvePreviewToken()
  if (!expectedToken) {
    return notFoundResponse()
  }

  if (hasCookieToken(request, PREVIEW_COOKIE_NAME, expectedToken)) {
    if (request.nextUrl.searchParams.has("token")) {
      const response = buildCleanRedirect(request)
      setAccessCookie(response, PREVIEW_COOKIE_NAME, expectedToken, "/preview")
      return response
    }

    return null
  }

  if (!hasBootstrapToken(request, expectedToken)) {
    return notFoundResponse()
  }

  const response = buildCleanRedirect(request)
  setAccessCookie(response, PREVIEW_COOKIE_NAME, expectedToken, "/preview")
  return response
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (pathname.startsWith("/preview/")) {
    const response = protectPreviewRoute(request)
    return response ? withContentSecurityPolicy(request, response) : nextWithContentSecurityPolicy(request)
  }

  if (pathname.startsWith("/internaltest") || pathname.startsWith("/styleguide")) {
    const response = protectInternalRoute(request)
    return response ? withContentSecurityPolicy(request, response) : nextWithContentSecurityPolicy(request)
  }

  if (pathname.startsWith("/candidato/")) {
    const guardResponse = await guardCandidatoRoute(request)
    if (guardResponse) return withContentSecurityPolicy(request, guardResponse)
  }

  if (pathname.startsWith("/rankings/")) {
    const guardResponse = guardRankingRoute(request)
    if (guardResponse) return withContentSecurityPolicy(request, guardResponse)
  }

  if (pathname.startsWith("/uf/")) {
    const guardResponse = guardUfRoute(request)
    if (guardResponse) return withContentSecurityPolicy(request, guardResponse)
  }

  return nextWithContentSecurityPolicy(request)
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
}
