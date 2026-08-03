import { NextResponse } from "next/server"
import { getLegislacaoExecutivoBySlugResource } from "@/lib/api"
import { toPublicLegislacaoExecutivoDto } from "@/lib/public-profile-dto"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const resource = await getLegislacaoExecutivoBySlugResource(slug)

  if (!resource.data) {
    return NextResponse.json(
      {
        data: null,
        sourceStatus: resource.sourceStatus,
        sourceMessage: resource.sourceMessage ?? "Candidato não encontrado.",
      },
      { status: resource.sourceStatus === "live" ? 404 : 503 },
    )
  }

  return NextResponse.json(
    {
      data: {
        rows: toPublicLegislacaoExecutivoDto(resource.data.rows),
        total: resource.data.total,
      },
      sourceStatus: resource.sourceStatus,
      sourceMessage: resource.sourceMessage ?? null,
    },
    { headers: { "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=3600" } },
  )
}
