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

/**
 * Honestidade sobre o vazio (2026-08-05): processos judiciais não têm ingest.
 * Os 30 processos do site vêm de verificação manual num grupo restrito de
 * candidatos, e não existe base pública que permita buscar processo por
 * pessoa (a API pública do DataJud/CNJ não expõe as partes; verificado em
 * 05/08/2026, ver docs/criterio-processos-judiciais.md). A copy anterior
 * ("não foram encontrados... nas bases consultadas") afirmava uma consulta
 * que nunca aconteceu, e deixava o leitor inferir ficha limpa.
 */
export function getProcessosEmptyState() {
  return {
    title: "Processos judiciais ainda não verificados",
    description:
      "Ainda não fizemos busca ativa de processos para esta ficha. Os processos exibidos no site vêm de verificação manual em fontes públicas (tribunais superiores, Ministério Público e imprensa) para parte dos candidatos, porque não existe base pública que permita buscar processos por pessoa. A ausência de registros aqui não significa ficha limpa.",
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
