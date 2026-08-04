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
    // Pior caso real: 3.600 linhas, ~1,1 MB de JSON (~144 KB gzip na rede) e
    // ~9s de fetch paginado no servidor. Re-paginar aqui foi rejeitado no #65
    // (multiplicaria leituras no Supabase); o alívio é a janela SWR de 24h:
    // depois do s-maxage o CDN responde o stale na hora e revalida em
    // background, tirando o custo frio do caminho do usuário sem nenhuma
    // leitura extra no banco.
    { headers: { "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400" } },
  )
}
