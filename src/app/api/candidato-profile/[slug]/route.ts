import { NextResponse } from "next/server"
import { getCandidatoBySlugResource } from "@/lib/api"
import { toPublicCandidatoProfileDto } from "@/lib/public-profile-dto"

// A ficha ja usa `unstable_cache` com a tag `public-candidato-ficha` em
// getCandidatoBySlugResource. Manter tambem o Route Cache/CDN por uma hora faz
// o POST /api/revalidate limpar os dados sem limpar a resposta HTTP antiga.
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const resource = await getCandidatoBySlugResource(slug)

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
      data: toPublicCandidatoProfileDto(resource.data),
      sourceStatus: resource.sourceStatus,
      sourceMessage: resource.sourceMessage ?? null,
    },
    {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  )
}
