import { ArrowRight } from "lucide-react"
import { NoticePanel } from "./NoticePanel"

interface EmptyStateProps {
  title: string
  description: string
  type?: "neutral" | "notable"
  suggestLabel?: string
  onSuggest?: () => void
}

export function EmptyState({ title, description, type = "neutral", suggestLabel, onSuggest }: EmptyStateProps) {
  return (
    <NoticePanel
      tone={type === "notable" ? "caution" : "neutral"}
      eyebrow={type === "notable" ? "Dado relevante" : undefined}
      title={title}
      description={description}
      align="center"
      rail={type === "notable"}
      className="mt-6"
      action={
        suggestLabel && onSuggest ? (
          <button
            onClick={onSuggest}
            className="inline-flex items-center gap-1.5 rounded-full border border-foreground px-4 py-1.5 text-[length:var(--text-caption)] font-bold text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            {suggestLabel}
            <ArrowRight className="size-3" />
          </button>
        ) : undefined
      }
    />
  )
}

export function getPatrimonioEmptyState(hasHistorico: boolean) {
  if (hasHistorico) {
    return {
      title: "Nenhum patrimônio declarado no TSE",
      description: "Para um candidato com histórico de cargos públicos, a ausência de declaração de bens é uma informação relevante.",
      type: "notable" as const,
    }
  }
  return {
    title: "Sem declaração de patrimônio",
    description: "Este candidato não possui declarações de bens registradas no TSE.",
    type: "neutral" as const,
  }
}

export function getProcessosEmptyState() {
  return {
    title: "Nenhum processo encontrado",
    description: "Não foram encontrados processos judiciais associados a este candidato nas bases consultadas.",
    type: "neutral" as const,
  }
}

export function getVotosEmptyState(hasLegislativeHistory: boolean) {
  if (!hasLegislativeHistory) {
    return {
      title: "Sem histórico legislativo estruturado",
      description:
        "O histórico público estruturado desta ficha ainda não traz mandato legislativo; por isso não exibimos votações registradas neste recorte.",
      type: "neutral" as const,
    }
  }
  return {
    title: "Votações ainda não coletadas",
    description:
      "As bases consultadas ainda não têm votações-chave estruturadas para esta ficha.",
    type: "neutral" as const,
  }
}

export function getTrajetoriaEmptyState() {
  return {
    title: "Primeira candidatura",
    description: "Este candidato não possui histórico de cargos públicos eletivos registrados.",
    type: "neutral" as const,
  }
}

export function getLegislacaoEmptyState(hasLegislativeHistory: boolean) {
  if (!hasLegislativeHistory) {
    return {
      title: "Sem histórico legislativo estruturado",
      description:
        "O histórico público estruturado desta ficha ainda não traz mandato legislativo; por isso não exibimos projetos ou atos legislativos neste recorte.",
      type: "neutral" as const,
    }
  }
  return {
    title: "Projetos de lei ainda não coletados",
    description:
      "As bases consultadas ainda não têm projetos ou atos legislativos com fonte estruturada para esta ficha.",
    type: "neutral" as const,
  }
}

export function getFinanciamentoEmptyState() {
  return {
    title: "Sem dados de financiamento",
    description: "Não há registros de financiamento de campanha para este candidato no TSE.",
    type: "neutral" as const,
  }
}
