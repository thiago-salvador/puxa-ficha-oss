import { NextResponse } from "next/server"
import { getProjetosLeiBySlugResource } from "@/lib/api"
import { toPublicProjetosLeiDto } from "@/lib/public-profile-dto"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const url = new URL(request.url)
  const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10)
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10)
  const resource = await getProjetosLeiBySlugResource(
    slug,
    Number.isFinite(offset) ? offset : 0,
    Number.isFinite(limit) ? limit : 100,
  )

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
        ...resource.data,
        rows: toPublicProjetosLeiDto(resource.data.rows),
      },
      sourceStatus: resource.sourceStatus,
      sourceMessage: resource.sourceMessage ?? null,
    },
    { headers: { "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=3600" } },
  )
}
