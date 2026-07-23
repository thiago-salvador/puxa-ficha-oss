import { NextResponse, type NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { resolveQuizShortToken } from "@/lib/quiz-short-link-resolve"

export const dynamic = "force-dynamic"

function resolveShortTokenForRoute(token: string) {
  return Sentry.startSpan(
    {
      name: "quiz_short_link.resolve",
      op: "db.supabase.query",
      attributes: {
        "http.route": "/quiz/r/[token]",
        "puxaficha.token_length": token.length,
      },
    },
    () => resolveQuizShortToken(token),
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const qs = await resolveShortTokenForRoute(token)

  if (!qs) {
    return new NextResponse("Link de resultado inválido ou expirado.", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    })
  }

  const target = new URL(`/quiz/resultado?${qs}`, request.nextUrl.origin)
  return NextResponse.redirect(target, 307)
}
