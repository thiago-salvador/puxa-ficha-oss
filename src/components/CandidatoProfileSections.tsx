"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import {
  EmptyState,
  getFinanciamentoEmptyState,
  getLegislacaoEmptyState,
  getPatrimonioEmptyState,
  getTrajetoriaEmptyState,
} from "./EmptyState"
import { buildDoadorReverseHref } from "@/lib/doador-reverse-shared"
import { ExpandableCard } from "./ExpandableCard"
import { HorizontalBars, PatrimonioChart, StackedBar } from "./BarChart"
import { MetaBadge } from "./MetaBadge"
import { NoticePanel } from "./NoticePanel"
import { SectionLabel, SectionTitle } from "./SectionHeader"
import { formatDate, formatBRL, safeHref } from "@/lib/utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { HorizontalScrollButtons } from "./HorizontalScrollButtons"
import type {
  Financiamento,
  GastoParlamentar,
  HistoricoPolitico,
  LegislacaoMandatoExecutivo,
  MudancaPartido,
  Patrimonio,
  ProjetoLei,
  SectionFreshnessInfo,
  VotoCandidato,
} from "@/lib/types"
import { ExternalLink } from "lucide-react"
import { DataFreshnessNotice } from "./DataFreshnessNotice"
import * as historicoDisplay from "@/lib/historico-display"
import { hasWideManualOverlappingSegmentedMandates } from "@/lib/historico-dedupe"
import { formatPartyTransitionLabel, hasSameYearPartyReversal } from "@/lib/party-switches"
import { isUncertainParty, normalizePartySigla } from "@/lib/party-utils"
import {
  mudancasPartidoLinhasPublicas,
  prepareHistoricoPoliticoPublicDisplayList,
} from "@/lib/trajetoria-public-display"
import { formatFinanciamentoPleitoPublicLabelForRow } from "@/lib/financiamento-pleito-public-label"
import {
  type FinancingBreakdownKey,
  FINANCING_BREAKDOWN_KEYS,
  formatFinancingLabel,
  formatProjectStatusLabel,
  formatPublicLabel,
  formatTemaLabel,
  formatVoteBadgeLabel,
} from "@/lib/ui-labels"
import {
  financiamentoPleitoNotaRodape,
  financiamentoPleitoSubtitulo,
} from "@/lib/financiamento-pleito-display"
import {
  groupLegislacaoProfileItems,
  resolveExecutiveLegislationInventoryScope,
} from "@/lib/legislacao-profile-groups"
import { sanitizePtBrText } from "@/lib/ptbr-text"

const LEGISLACAO_PAGE_SIZE = 25

interface SuggestAction {
  label: string
  go: () => void
}

const FINANCING_COLORS: Record<FinancingBreakdownKey, string> = {
  fundo_eleitoral: "#0a0a0a",
  fundo_partidario: "#525252",
  pessoa_fisica: "#a3a3a3",
  recursos_proprios: "#d4d4d4",
}

const PROJECT_STATUS_BADGES: Record<
  string,
  { tone: "neutral" | "muted" | "positive" | "critical" }
> = {
  aprovado: { tone: "positive" },
  tramitando: { tone: "neutral" },
  vetado: { tone: "critical" },
}

function formatYearList(years: number[]) {
  if (years.length <= 2) return years.join(" e ")
  return `${years.slice(0, -1).join(", ")} e ${years.at(-1)}`
}

interface MoneyTabSectionProps {
  patrimonio: Patrimonio[]
  financiamento: Financiamento[]
  /** Bruto (API); usado só para rótulos de pleito em financiamento, não para `cargo_disputado` atual. */
  historico: HistoricoPolitico[]
  gastos: GastoParlamentar[]
  historicoLength: number
  suggestion: SuggestAction | null
  /** Id do evento na timeline (`patrimonio-…`, `gasto-…`) para abrir card e permitir scroll/highlight. */
  highlightTimelineRef?: string | null
  freshness?: {
    patrimonio?: SectionFreshnessInfo
    financiamento?: SectionFreshnessInfo
    gastos_parlamentares?: SectionFreshnessInfo
  }
}

export function MoneyTabSection({
  patrimonio,
  financiamento,
  historico,
  gastos,
  historicoLength,
  suggestion,
  highlightTimelineRef,
  freshness,
}: MoneyTabSectionProps) {
  return (
    <div className="space-y-12">
      {patrimonio.length > 0 && (
        <div>
          <SectionLabel>Patrimônio declarado</SectionLabel>
          <SectionTitle>{patrimonio.length > 1 ? "Evolução patrimonial" : "Patrimônio declarado"}</SectionTitle>
          <div className="mt-4">
            <DataFreshnessNotice info={freshness?.patrimonio} />
          </div>
          <div className="mt-6">
            <PatrimonioChart
              data={patrimonio.map((item) => ({
                id: item.id,
                ano: item.ano_eleicao,
                valor: item.valor_total,
              }))}
            />
          </div>
          <div className="mt-6 space-y-3">
            {[...patrimonio]
              .sort((a, b) => b.ano_eleicao - a.ano_eleicao)
              .filter((item) => (item.bens ?? []).length > 0)
              .map((item) => (
                <div key={item.id} data-pf-timeline-ref={`patrimonio-${item.id}`}>
                <ExpandableCard
                  title={`${item.ano_eleicao}`}
                  subtitle={formatBRL(item.valor_total)}
                  defaultOpen={highlightTimelineRef === `patrimonio-${item.id}`}
                >
                  <div className="space-y-2">
                    {(item.bens ?? []).map((bem, index) => (
                      <div
                        key={index}
                        className="flex items-baseline justify-between rounded-[8px] bg-muted px-3 py-2"
                      >
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                            {bem.tipo}
                          </span>
                          <p className="text-[length:var(--text-body-sm)] font-medium text-foreground">
                            {bem.descricao}
                          </p>
                        </div>
                        <span className="ml-3 shrink-0 text-[length:var(--text-body)] font-bold tabular-nums text-foreground">
                          {formatBRL(bem.valor)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ExpandableCard>
                </div>
              ))}
          </div>
        </div>
      )}

      {financiamento.length > 0 && (
        <div>
          <SectionLabel>Financiamento de campanha</SectionLabel>
          <SectionTitle>De onde vem o dinheiro</SectionTitle>
          <div className="mt-4">
            <DataFreshnessNotice info={freshness?.financiamento} />
          </div>
          <div className="mt-6 space-y-6">
            {[...financiamento]
              .sort((a, b) => b.ano_eleicao - a.ano_eleicao)
              .map((item) => (
                <div
                  key={item.id}
                  data-pf-timeline-ref={`financiamento-${item.id}`}
                  className="space-y-4 rounded-[16px] border border-border/50 px-5 py-5"
                  title={financiamentoPleitoNotaRodape()}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[length:var(--text-eyebrow)] font-bold tracking-[0.04em] text-foreground">
                        {formatFinanciamentoPleitoPublicLabelForRow(item, historico)}
                      </p>
                      <p className="mt-1 text-[11px] font-medium leading-snug text-muted-foreground">
                        {financiamentoPleitoSubtitulo()}
                      </p>
                    </div>
                    <span className="shrink-0 text-[24px] font-bold tracking-tight text-foreground sm:text-right sm:text-[28px]">
                      {formatBRL(item.total_arrecadado)}
                    </span>
                  </div>
                  <StackedBar
                    segments={FINANCING_BREAKDOWN_KEYS.map((key) => ({
                      label: formatFinancingLabel(key),
                      value:
                        key === "fundo_eleitoral"
                          ? item.total_fundo_eleitoral
                          : key === "fundo_partidario"
                            ? item.total_fundo_partidario
                            : key === "pessoa_fisica"
                              ? item.total_pessoa_fisica
                              : item.total_recursos_proprios,
                      color: FINANCING_COLORS[key],
                    }))}
                  />
                  {(item.maiores_doadores ?? []).length > 0 && (
                    <div className="mt-3 border-t border-border/50 pt-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                        Maiores doadores
                      </p>
                      <div className="space-y-1.5">
                        {(item.maiores_doadores ?? []).map((doador, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between text-[length:var(--text-body-sm)]"
                          >
                            <Link
                              href={buildDoadorReverseHref(doador.nome)}
                              className="font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              {doador.nome}
                            </Link>
                            <span className="font-bold tabular-nums text-foreground">
                              {formatBRL(doador.valor)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {patrimonio.length === 0 && financiamento.length === 0 && (
        <div>
          <SectionLabel>Dinheiro</SectionLabel>
          <SectionTitle>Dados financeiros</SectionTitle>
          <EmptyState
            {...getPatrimonioEmptyState(historicoLength > 0)}
            suggestLabel={suggestion?.label}
            onSuggest={suggestion?.go}
          />
        </div>
      )}
      {patrimonio.length === 0 && financiamento.length > 0 && (
        <EmptyState {...getPatrimonioEmptyState(historicoLength > 0)} />
      )}
      {financiamento.length === 0 && patrimonio.length > 0 && (
        <EmptyState {...getFinanciamentoEmptyState()} />
      )}

      {gastos.length > 0 && (
        <div>
          <SectionLabel>Gastos parlamentares</SectionLabel>
          <SectionTitle>Uso da cota parlamentar (CEAP)</SectionTitle>
          <div className="mt-4">
            <DataFreshnessNotice info={freshness?.gastos_parlamentares} />
          </div>
          <div className="mt-6 space-y-4">
            {gastos.map((gasto) => (
              <div key={gasto.id} data-pf-timeline-ref={`gasto-${gasto.id}`}>
              <ExpandableCard
                title={`${gasto.ano}`}
                subtitle={formatBRL(gasto.total_gasto)}
                defaultOpen={gastos.length === 1 || highlightTimelineRef === `gasto-${gasto.id}`}
              >
                <div className="space-y-4">
                  {(gasto.detalhamento ?? []).length > 0 && (
                    <HorizontalBars
                      items={(gasto.detalhamento ?? []).map((item) => ({
                        label: formatPublicLabel(item.categoria),
                        value: item.valor,
                      }))}
                    />
                  )}
                  {(gasto.gastos_destaque ?? []).length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                        Destaques
                      </p>
                      {(gasto.gastos_destaque ?? []).map((item, index) => (
                        <div key={index} className="rounded-[12px] border border-border/60 bg-background px-3 py-3">
                          <MetaBadge tone="critical">Destaque</MetaBadge>
                          <p className="mt-2 text-[length:var(--text-body-sm)] font-medium text-foreground">
                            {item.descricao}
                          </p>
                          <p className="mt-1 text-[length:var(--text-caption)] font-semibold text-muted-foreground">
                            {formatPublicLabel(item.categoria)}
                          </p>
                          <p className="mt-1 text-[length:var(--text-caption)] font-bold text-muted-foreground">
                            {formatBRL(item.valor)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </ExpandableCard>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface TrajectoryTabSectionProps {
  historico: HistoricoPolitico[]
  mudancas: MudancaPartido[]
  historicoDescartado: number
  timelinePartidariaIncompleta: boolean
  partidoAtualSigla: string | null
  partidoAtualNome: string | null
  suggestion: SuggestAction | null
  freshness?: {
    historico_politico?: SectionFreshnessInfo
    mudancas_partido?: SectionFreshnessInfo
  }
}

export function TrajectoryTabSection({
  historico,
  mudancas,
  historicoDescartado,
  timelinePartidariaIncompleta,
  partidoAtualSigla,
  partidoAtualNome,
  suggestion,
  freshness,
}: TrajectoryTabSectionProps) {
  const historicoOrdenado = prepareHistoricoPoliticoPublicDisplayList(historico)
  const mudancasLinhasTimeline = mudancasPartidoLinhasPublicas(mudancas)
  const currentPartyLabel = [partidoAtualSigla, partidoAtualNome]
    .filter((value): value is string => Boolean(value) && !isUncertainParty(value))
    .join(" · ")
  const currentPartyTokens = [partidoAtualSigla, partidoAtualNome]
    .map(normalizePartySigla)
    .filter(Boolean)
  const currentPartyHistoricoYears = Array.from(
    new Set(
      historico
        .filter((item) => currentPartyTokens.includes(normalizePartySigla(item.partido)))
        .map((item) => item.periodo_inicio)
        .filter((year): year is number => typeof year === "number")
    )
  ).sort((a, b) => a - b)
  const shouldShowPartySection = mudancas.length > 0 || Boolean(currentPartyLabel)
  // Phase 0 containment: block sections with structural contradictions until
  // editorial curation lands.
  const partyTimelineBlocked = hasSameYearPartyReversal(mudancas)
  const historicoBlocked = hasWideManualOverlappingSegmentedMandates(historico)

  return (
    <div className="space-y-12">
      {historicoDescartado > 0 || timelinePartidariaIncompleta ? (
        <NoticePanel
          tone="caution"
          eyebrow="Trajetória em revisão"
          description={
            <div className="space-y-2">
              {historicoDescartado > 0 && (
                <p>
                  Ocultamos {historicoDescartado} registro{historicoDescartado > 1 ? "s" : ""} de
                  trajetória porque a origem não confirma período ou filiação com segurança.
                </p>
              )}
              {timelinePartidariaIncompleta && currentPartyLabel && (
                <p>
                  Filiação atual publicada: {currentPartyLabel}. A linha do tempo partidária abaixo
                  ainda não incorpora essa atualização.
                </p>
              )}
            </div>
          }
        />
      ) : null}

      {historico.length === 0 && mudancas.length === 0 && (
        <div>
          <SectionLabel>Trajetória</SectionLabel>
          <SectionTitle>Histórico político</SectionTitle>
          <EmptyState
            {...getTrajetoriaEmptyState()}
            suggestLabel={suggestion?.label}
            onSuggest={suggestion?.go}
          />
        </div>
      )}

      {historico.length > 0 && historicoBlocked && (
        <div data-pf-trajetoria-blocked="wide-manual-vs-segmented">
          <SectionLabel>Trajetória política</SectionLabel>
          <SectionTitle>Cargos e mandatos</SectionTitle>
          <div className="mt-4">
            <NoticePanel
              tone="caution"
              eyebrow="Seção em curadoria"
              description={
                <p>
                  Detectamos uma row ampla de carreira convivendo com dois ou
                  mais mandatos segmentados do mesmo cargo. Ocultamos a lista
                  até a curadoria reconciliar os períodos.
                </p>
              }
            />
          </div>
        </div>
      )}

      {historico.length > 0 && !historicoBlocked && (
        <div data-pf-trajetoria-count={historicoOrdenado.length}>
          <SectionLabel>Trajetória política</SectionLabel>
          <SectionTitle>Cargos e mandatos</SectionTitle>
          <div className="mt-4">
            <DataFreshnessNotice info={freshness?.historico_politico} />
          </div>
          <div className="mt-6">
            {historicoOrdenado.map((item, index) => (
                <div
                  key={item.id}
                  data-pf-timeline-ref={`cargo-${item.id}`}
                  className="relative flex gap-4 pb-6 last:pb-0 sm:gap-6"
                >
                  <div className="flex flex-col items-center">
                    <div className="size-3 rounded-full border-2 border-foreground bg-background" />
                    {index < historicoOrdenado.length - 1 && (
                      <div className="w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="flex-1 -mt-0.5">
                    <span className="text-[length:var(--text-caption)] font-bold tabular-nums text-muted-foreground sm:text-[length:var(--text-body-sm)]">
                      {historicoDisplay.formatHistoricoPeriodoDisplay(item, historicoOrdenado)}
                    </span>
                    <p className="mt-0.5 text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">
                      {historicoDisplay.formatHistoricoCargoTituloPublico(item)}
                    </p>
                    <p className="text-[length:var(--text-body-sm)] font-semibold text-muted-foreground">
                      {historicoDisplay.formatHistoricoPartidoEstadoLine(item)}
                    </p>
                    {(() => {
                      const obs = historicoDisplay.formatHistoricoObservacaoPublica(
                        item.observacoes,
                      )
                      return obs ? (
                      <p className="mt-0.5 text-[length:var(--text-caption)] font-medium text-muted-foreground">
                        {obs}
                      </p>
                    ) : null })()}
                  </div>
                </div>
            ))}
          </div>
        </div>
      )}

      {shouldShowPartySection && partyTimelineBlocked && (
        <div data-pf-partidos-blocked="same-year-reversal">
          <SectionLabel>Trocas de partido</SectionLabel>
          <SectionTitle>Histórico partidário</SectionTitle>
          <div className="mt-4">
            <NoticePanel
              tone="caution"
              eyebrow="Seção em curadoria"
              description={
                <p>
                  A linha do tempo partidária contém uma reversão A→B e B→A no
                  mesmo ano, padrão estruturalmente impossível que indica
                  mistura de homônimos ou ordem incorreta na ingestão. Ocultamos
                  a lista até a curadoria reconstruir a sequência canônica.
                </p>
              }
            />
          </div>
        </div>
      )}

      {shouldShowPartySection && !partyTimelineBlocked && (
        <div data-pf-partidos-count={mudancasLinhasTimeline}>
          <SectionLabel>Trocas de partido ({mudancasLinhasTimeline})</SectionLabel>
          <SectionTitle>Histórico partidário</SectionTitle>
          {mudancas.length > 0 ? (
            <>
              <div className="mt-4">
                <DataFreshnessNotice info={freshness?.mudancas_partido} />
              </div>
              <div className="mt-6 space-y-0">
                {[...mudancas]
                  .sort((a, b) => b.ano - a.ano)
                  .map((item, index) => (
                    <div
                      key={item.id}
                      data-pf-timeline-ref={`partido-${item.id}`}
                      className={`flex items-baseline gap-4 py-3 sm:gap-6 sm:py-4 ${index > 0 ? "border-t border-border/50" : ""}`}
                    >
                      <span className="w-[50px] shrink-0 text-[length:var(--text-caption)] font-bold tabular-nums text-foreground sm:w-[60px] sm:text-[length:var(--text-body-sm)]">
                        {item.ano}
                      </span>
                      <div>
                        <p className="text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">
                          {formatPartyTransitionLabel(item)}
                        </p>
                        {item.contexto && (
                          <p className="text-[length:var(--text-body-sm)] font-medium text-muted-foreground">
                            {item.contexto}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <div className="mt-6 flex items-baseline gap-4 py-3 sm:gap-6 sm:py-4">
              <span className="w-[50px] shrink-0 text-[length:var(--text-caption)] font-bold text-foreground sm:w-[60px] sm:text-[length:var(--text-body-sm)]">
                Atual
              </span>
              <div>
                <p className="text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">
                  Filiação atual: {currentPartyLabel}
                </p>
                <p className="text-[length:var(--text-body-sm)] font-medium text-muted-foreground">
                  Sem trocas de partido registradas na base.
                  {currentPartyHistoricoYears.length > 0
                    ? ` Candidaturas estruturadas: ${formatYearList(currentPartyHistoricoYears)}.`
                    : ""}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface LegislationTabSectionProps {
  projetosLei: ProjetoLei[]
  legislacaoMandatoExecutivo: LegislacaoMandatoExecutivo[]
  votos: VotoCandidato[]
  cargoDisputado?: string | null
  hasLegislativeHistory: boolean
  suggestion: SuggestAction | null
  freshness?: SectionFreshnessInfo
  projetosLeiLoadState?: "idle" | "loading" | "loaded" | "failed"
  projetosLeiTotal?: number
}

const EXECUTIVE_RELATION_LABELS: Record<LegislacaoMandatoExecutivo["tipo_relacao"], string> = {
  lei_sancionada: "Lei sancionada",
  projeto_enviado_pelo_executivo: "Projeto enviado pelo Executivo",
  lei_promulgada_pelo_legislativo: "Promulgada pelo Legislativo",
}

function LegislationSubtabCount({ count }: { count: number }) {
  return (
    <span className="ml-1 shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
      {count}
    </span>
  )
}

function LegislationInventoryScopeNotice({ description }: { description: string }) {
  return (
    <p
      data-pf-legislation-inventory-scope
      className="max-w-3xl text-[length:var(--text-body-sm)] font-medium leading-relaxed text-muted-foreground"
    >
      {description}
    </p>
  )
}

function LegislationSubtabEmpty({ title }: { title: string }) {
  return (
    <NoticePanel
      tone="neutral"
      eyebrow="Sem registros"
      title={title}
      description="A base pública não tem itens classificados nesta categoria para este candidato."
    />
  )
}

function LegislationPaginationControls({
  currentPage,
  totalPages,
  pageStart,
  pageEnd,
  totalItems,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  pageStart: number
  pageEnd: number
  totalItems: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  const canGoBack = currentPage > 1
  const canGoForward = currentPage < totalPages

  return (
    <div
      className="mt-4 flex flex-col gap-3 rounded-[8px] border border-border/50 bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-pf-legislation-pagination
    >
      <p className="text-[length:var(--text-caption)] font-bold text-muted-foreground">
        Mostrando {pageStart + 1}-{pageEnd} de {totalItems} itens
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded-[8px] border border-border bg-background px-3 text-[length:var(--text-caption)] font-bold text-foreground transition-colors hover:border-foreground/30 disabled:pointer-events-none disabled:opacity-40"
          disabled={!canGoBack}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Anterior
        </button>
        <span className="min-w-[5.5rem] text-center text-[length:var(--text-caption)] font-bold tabular-nums text-muted-foreground">
          {currentPage} / {totalPages}
        </span>
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded-[8px] border border-border bg-background px-3 text-[length:var(--text-caption)] font-bold text-foreground transition-colors hover:border-foreground/30 disabled:pointer-events-none disabled:opacity-40"
          disabled={!canGoForward}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  )
}

function ExecutiveLegislationList({
  items,
  label = `Atos do Executivo no mandato (${items.length})`,
  title = "Legislação do Executivo",
  description = resolveExecutiveLegislationInventoryScope(items).listDescription,
}: {
  items: LegislacaoMandatoExecutivo[]
  label?: string
  title?: string
  description?: string
}) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / LEGISLACAO_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * LEGISLACAO_PAGE_SIZE
  const pageEnd = Math.min(pageStart + LEGISLACAO_PAGE_SIZE, items.length)
  const visibleItems = useMemo(
    () => items.slice(pageStart, pageEnd),
    [items, pageEnd, pageStart],
  )

  if (items.length === 0) return null

  return (
    <div
      data-pf-executive-legislation-list
      data-pf-legislation-total={items.length}
      data-pf-legislation-page-size={LEGISLACAO_PAGE_SIZE}
      data-pf-legislation-current-page={currentPage}
      data-pf-legislation-visible-count={visibleItems.length}
    >
      <SectionLabel>{label}</SectionLabel>
      <SectionTitle>{title}</SectionTitle>
      {description && (
        <p className="mt-2 max-w-3xl text-[length:var(--text-body-sm)] font-medium leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      <LegislationPaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        pageStart={pageStart}
        pageEnd={pageEnd}
        totalItems={items.length}
        onPageChange={setPage}
      />
      <div className="mt-6 max-w-full space-y-3">
        {visibleItems.map((lei) => {
          const identifier = [
            lei.tipo_norma,
            lei.numero && lei.ano ? `${lei.numero}/${lei.ano}` : lei.numero || lei.ano,
          ]
            .filter(Boolean)
            .join(" ")

          const tipoRelacaoLabel = EXECUTIVE_RELATION_LABELS[lei.tipo_relacao] ?? "Ato do Executivo"

          return (
            <div
              key={lei.id}
              data-pf-timeline-ref={`lme-${lei.id}`}
              data-pf-executive-legislation-card
              className="max-w-full overflow-hidden rounded-[12px] border border-border/50 bg-card px-4 py-4 sm:px-5"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-[length:var(--text-body)] font-bold text-foreground">
                  {identifier || "Norma"}
                </span>
                <MetaBadge tone="muted">{tipoRelacaoLabel}</MetaBadge>
                {lei.data_norma && (
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {formatDate(lei.data_norma)}
                  </span>
                )}
                {lei.autoridade_papel === "titular" && (
                  <MetaBadge tone="neutral">Titular</MetaBadge>
                )}
              </div>
              {lei.ementa && (
                <p className="mt-2 break-words text-[length:var(--text-body-sm)] font-medium leading-relaxed text-foreground">
                  {lei.ementa}
                </p>
              )}
              {lei.signatario && (
                <p className="mt-1 break-words text-[length:var(--text-caption)] font-semibold text-muted-foreground">
                  Signatário: {lei.signatario}
                </p>
              )}
              {safeHref(lei.fonte_primaria_url) && (
                <a
                  href={safeHref(lei.fonte_primaria_url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex max-w-full items-center gap-1 break-words text-[length:var(--text-caption)] font-semibold text-foreground underline"
                >
                  Fonte oficial <ExternalLink className="size-3 shrink-0" />
                </a>
              )}
            </div>
          )
        })}
      </div>
      <LegislationPaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        pageStart={pageStart}
        pageEnd={pageEnd}
        totalItems={items.length}
        onPageChange={setPage}
      />
    </div>
  )
}

function ProjetoLeiList({
  items,
  label = `Projetos de lei (${items.length})`,
  title = "Autoria legislativa",
  description,
  hasLegislativeHistory,
  suggestion,
  freshness,
  showEmptyState = false,
}: {
  items: ProjetoLei[]
  label?: string
  title?: string
  description?: string
  hasLegislativeHistory: boolean
  suggestion: SuggestAction | null
  freshness?: SectionFreshnessInfo
  showEmptyState?: boolean
}) {
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.destaque && !b.destaque) return -1
        if (!a.destaque && b.destaque) return 1
        return (b.ano ?? 0) - (a.ano ?? 0)
      }),
    [items],
  )
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / LEGISLACAO_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * LEGISLACAO_PAGE_SIZE
  const pageEnd = Math.min(pageStart + LEGISLACAO_PAGE_SIZE, sortedItems.length)
  const visibleItems = useMemo(
    () => sortedItems.slice(pageStart, pageEnd),
    [pageEnd, pageStart, sortedItems],
  )

  return (
    <div
      data-pf-legislative-project-list={items.length > 0 ? true : undefined}
      data-pf-legislation-total={items.length > 0 ? sortedItems.length : undefined}
      data-pf-legislation-page-size={items.length > 0 ? LEGISLACAO_PAGE_SIZE : undefined}
      data-pf-legislation-current-page={items.length > 0 ? currentPage : undefined}
      data-pf-legislation-visible-count={items.length > 0 ? visibleItems.length : undefined}
    >
      <SectionLabel>{label}</SectionLabel>
      <SectionTitle>{title}</SectionTitle>
      {description && (
        <p className="mt-2 max-w-3xl text-[length:var(--text-body-sm)] font-medium leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {items.length > 0 && freshness && (
        <div className="mt-4">
          <DataFreshnessNotice info={freshness} />
        </div>
      )}
      {items.length === 0 && showEmptyState && (
        <EmptyState
          {...getLegislacaoEmptyState(hasLegislativeHistory)}
          suggestLabel={suggestion?.label}
          onSuggest={suggestion?.go}
        />
      )}
      {items.length > 0 && (
        <>
          <LegislationPaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            pageStart={pageStart}
            pageEnd={pageEnd}
            totalItems={sortedItems.length}
            onPageChange={setPage}
          />
          <div className="mt-6 max-w-full space-y-3">
            {visibleItems.map((projeto) => (
              <div
                key={projeto.id}
                data-pf-timeline-ref={`pl-${projeto.id}`}
                className={`max-w-full overflow-hidden rounded-[12px] border border-border/50 bg-card px-4 py-4 sm:px-5 ${
                  projeto.destaque ? "border-l-[3px] border-l-foreground" : ""
                }`}
              >
                {(() => {
                  const identifier = [
                    projeto.tipo,
                    projeto.numero && projeto.ano
                      ? `${projeto.numero}/${projeto.ano}`
                      : projeto.numero || projeto.ano,
                  ]
                    .filter(Boolean)
                    .join(" ")

                  return (
                    <>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words text-[length:var(--text-body)] font-bold text-foreground">
                          {identifier ||
                            (projeto.ementa
                              ? projeto.ementa.slice(0, 80) +
                                (projeto.ementa.length > 80 ? "..." : "")
                              : "Projeto de lei")}
                        </span>
                        {projeto.situacao && (
                          <MetaBadge
                            tone={PROJECT_STATUS_BADGES[projeto.situacao]?.tone ?? "muted"}
                          >
                            {formatProjectStatusLabel(projeto.situacao)}
                          </MetaBadge>
                        )}
                        {projeto.destaque && (
                          <MetaBadge tone="neutral">
                            Destaque
                          </MetaBadge>
                        )}
                        {projeto.tema && (
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {formatTemaLabel(projeto.tema)}
                          </span>
                        )}
                      </div>
                      {projeto.ementa && identifier && (
                        <p className="mt-2 break-words text-[length:var(--text-body-sm)] font-medium leading-relaxed text-foreground">
                          {projeto.ementa}
                        </p>
                      )}
                    </>
                  )
                })()}
                {projeto.destaque_motivo && (
                  <p className="mt-1 break-words text-[length:var(--text-caption)] font-semibold text-muted-foreground">
                    {projeto.destaque_motivo}
                  </p>
                )}
                {safeHref(projeto.url_inteiro_teor) && (
                  <a
                    href={safeHref(projeto.url_inteiro_teor)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex max-w-full items-center gap-1 break-words text-[length:var(--text-caption)] font-semibold text-foreground underline"
                  >
                    Inteiro teor <ExternalLink className="size-3 shrink-0" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function VotedLegislationList({ items }: { items: VotoCandidato[] }) {
  if (items.length === 0) return <LegislationSubtabEmpty title="Nenhuma votação isolada encontrada" />

  return (
    <div>
      <SectionLabel>Votou sem autoria registrada ({items.length})</SectionLabel>
      <SectionTitle>Votações em legislação</SectionTitle>
      <div className="mt-6 space-y-3">
        {items.map((voto) => (
          <div
            key={voto.id}
            data-pf-voto-card
            data-pf-voto-id={voto.votacao_id}
            data-pf-voto-date={voto.votacao?.data_votacao ?? ""}
            data-pf-voto-title={voto.votacao?.titulo ?? ""}
            data-pf-timeline-ref={`voto-${voto.id}`}
            className={`rounded-[12px] border border-border/50 bg-card px-5 py-4 ${
              voto.contradicao ? "border-l-[3px] border-l-amber-400/80" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">
                  {voto.votacao?.titulo ? sanitizePtBrText(voto.votacao.titulo) : "Votação"}
                </p>
                {voto.votacao?.descricao && (
                  <p className="mt-1 text-[length:var(--text-body-sm)] font-medium text-muted-foreground">
                    {sanitizePtBrText(voto.votacao.descricao)}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {voto.votacao?.tema && (
                    <MetaBadge tone="muted">
                      {formatTemaLabel(voto.votacao.tema)}
                    </MetaBadge>
                  )}
                  {voto.votacao?.casa && (
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {voto.votacao.casa} | {voto.votacao.data_votacao ? formatDate(voto.votacao.data_votacao) : ""}
                    </span>
                  )}
                </div>
                {voto.contradicao && voto.contradicao_descricao && (
                  <div className="mt-3 border-l-2 border-amber-400/70 bg-muted/30 px-3 py-2.5">
                    <p className="text-[length:var(--text-caption)] font-bold uppercase tracking-[0.08em] text-foreground">
                      Contradição editorial
                    </p>
                    <p className="mt-1 text-[length:var(--text-caption)] font-semibold text-muted-foreground">
                      {sanitizePtBrText(voto.contradicao_descricao)}
                    </p>
                  </div>
                )}
                {voto.votacao?.impacto_popular && (
                  <p className="mt-1.5 text-[length:var(--text-caption)] font-medium text-muted-foreground">
                    Impacto: {voto.votacao.impacto_popular}
                  </p>
                )}
              </div>
              <span
                className={`mt-1 shrink-0 rounded-full px-3.5 py-1.5 text-[length:var(--text-caption)] font-bold uppercase tracking-[0.05em] ${
                  voto.voto === "sim"
                    ? "bg-foreground text-background"
                    : voto.voto === "não"
                      ? "border border-foreground bg-transparent text-foreground"
                      : "bg-secondary text-foreground"
                }`}
              >
                {formatVoteBadgeLabel(voto.voto)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LegislationTabSection({
  projetosLei,
  legislacaoMandatoExecutivo,
  votos,
  cargoDisputado,
  hasLegislativeHistory,
  suggestion,
  freshness,
  projetosLeiLoadState = "loaded",
  projetosLeiTotal = projetosLei.length,
}: LegislationTabSectionProps) {
  const groups = groupLegislacaoProfileItems({
    projetosLei,
    legislacaoMandatoExecutivo,
    votos,
    cargoDisputado,
  })
  const hasAnyLegislation = groups.totalCount > 0
  const hasFeaturedLegislation = groups.hasLegislationHighlights
  const defaultSubtab = hasFeaturedLegislation ? "destaques" : "todas"
  const inventoryTabLabel = hasAnyLegislation ? groups.inventoryScope.tabLabel : "Todas"
  const shouldShowInventoryScopeNotice =
    hasAnyLegislation && Boolean(groups.inventoryScope.listDescription)
  const legislationSubtabsRef = useRef<HTMLDivElement | null>(null)
  const renderInventoryScopeNotice = () =>
    shouldShowInventoryScopeNotice ? (
      <LegislationInventoryScopeNotice description={groups.inventoryScope.listDescription} />
    ) : null

  return (
    <Tabs defaultValue={defaultSubtab} className="gap-8">
      {projetosLeiLoadState === "loading" && (
        <NoticePanel tone="neutral">
          Carregando o inventário legislativo completo ({projetosLeiTotal} projetos)…
        </NoticePanel>
      )}
      {projetosLeiLoadState === "failed" && (
        <NoticePanel tone="caution">
          Não foi possível carregar todos os {projetosLeiTotal} projetos agora. A prévia disponível continua abaixo.
        </NoticePanel>
      )}
      <div className="relative max-w-full min-w-0 overflow-hidden" data-pf-legislation-subtabs-scroll>
        <div
          ref={legislationSubtabsRef}
          className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden scroll-smooth px-0 scrollbar-none sm:px-9"
        >
          <TabsList className="min-w-full w-max max-w-none justify-start">
            {hasFeaturedLegislation && (
              <TabsTrigger value="destaques" className="max-w-[72vw] flex-none overflow-hidden sm:max-w-none">
                <span className="truncate">Destaques</span>
                <LegislationSubtabCount count={groups.featuredCount} />
              </TabsTrigger>
            )}
            <TabsTrigger value="todas" className="max-w-[72vw] flex-none overflow-hidden sm:max-w-none">
              <span className="truncate">{inventoryTabLabel}</span>
              <LegislationSubtabCount count={groups.totalCount} />
            </TabsTrigger>
            <TabsTrigger value="propostas" className="max-w-[72vw] flex-none overflow-hidden sm:max-w-none">
              <span className="truncate">Propôs</span>
              <LegislationSubtabCount count={groups.proposedCount} />
            </TabsTrigger>
            <TabsTrigger value="votadas" className="max-w-[72vw] flex-none overflow-hidden sm:max-w-none">
              <span className="truncate">Votou</span>
              <LegislationSubtabCount count={groups.votosApenas.length} />
            </TabsTrigger>
            <TabsTrigger value="aprovadas" className="max-w-[72vw] flex-none overflow-hidden sm:max-w-none">
              <span className="truncate">Aprovadas</span>
              <LegislationSubtabCount count={groups.approvedCount} />
            </TabsTrigger>
            <TabsTrigger value="executivo" className="max-w-[72vw] flex-none overflow-hidden sm:max-w-none">
              <span className="truncate">Executivo</span>
              <LegislationSubtabCount count={groups.executivo.length} />
            </TabsTrigger>
          </TabsList>
        </div>
        <HorizontalScrollButtons
          scrollRef={legislationSubtabsRef}
          ariaLabel="subabas de Legislação"
        />
      </div>

      {hasFeaturedLegislation && (
        <TabsContent value="destaques" className="space-y-12">
          {renderInventoryScopeNotice()}
          <ExecutiveLegislationList
            items={groups.destaquesExecutivo}
            label={`Destaques do Executivo (${groups.destaquesExecutivo.length})`}
            title="Destaques legislativos"
            description={groups.inventoryScope.featuredDescription}
          />
          {groups.destaquesParlamentares.length > 0 && (
            <ProjetoLeiList
              items={groups.destaquesParlamentares}
              label={`Projetos em destaque (${groups.destaquesParlamentares.length})`}
              title="Autoria legislativa em destaque"
              description="Recorte inicial de relevância pública em projetos de lei: inclui destaques editoriais quando existirem e sinais heurísticos na ementa. Não é uma curadoria editorial definitiva item a item."
              hasLegislativeHistory={hasLegislativeHistory}
              suggestion={suggestion}
              freshness={freshness}
            />
          )}
        </TabsContent>
      )}

      <TabsContent value="todas" className="space-y-12">
        {!hasAnyLegislation && (
          <EmptyState
            {...getLegislacaoEmptyState(hasLegislativeHistory)}
            suggestLabel={suggestion?.label}
            onSuggest={suggestion?.go}
          />
        )}
        {renderInventoryScopeNotice()}
        <ExecutiveLegislationList items={groups.executivo} />
        <ProjetoLeiList
          items={groups.propostasParlamentares}
          hasLegislativeHistory={hasLegislativeHistory}
          suggestion={suggestion}
          freshness={freshness}
        />
        {groups.votosApenas.length > 0 && <VotedLegislationList items={groups.votosApenas} />}
      </TabsContent>

      <TabsContent value="propostas" className="space-y-12">
        {renderInventoryScopeNotice()}
        <ExecutiveLegislationList
          items={groups.propostasExecutivo}
          label={`Projetos enviados pelo Executivo (${groups.propostasExecutivo.length})`}
          title="Propostas do Executivo"
        />
        <ProjetoLeiList
          items={groups.propostasParlamentares}
          hasLegislativeHistory={hasLegislativeHistory}
          suggestion={suggestion}
          freshness={freshness}
          showEmptyState={groups.propostasExecutivo.length === 0}
        />
      </TabsContent>

      <TabsContent value="votadas" className="space-y-12">
        {renderInventoryScopeNotice()}
        <VotedLegislationList items={groups.votosApenas} />
      </TabsContent>

      <TabsContent value="aprovadas" className="space-y-12">
        {renderInventoryScopeNotice()}
        {groups.approvedCount === 0 && (
          <LegislationSubtabEmpty title="Nenhum projeto aprovado ou lei sancionada encontrada" />
        )}
        <ExecutiveLegislationList
          items={groups.leisSancionadas}
          label={`Leis sancionadas (${groups.leisSancionadas.length})`}
          title="Aprovação no Executivo"
        />
        <ProjetoLeiList
          items={groups.projetosAprovados}
          label={`Projetos de autoria aprovados (${groups.projetosAprovados.length})`}
          title="Autoria legislativa aprovada"
          hasLegislativeHistory={hasLegislativeHistory}
          suggestion={suggestion}
          freshness={freshness}
        />
      </TabsContent>

      <TabsContent value="executivo" className="space-y-12">
        {renderInventoryScopeNotice()}
        {groups.executivo.length === 0 ? (
          <LegislationSubtabEmpty title="Nenhum ato do Executivo encontrado" />
        ) : (
          <ExecutiveLegislationList items={groups.executivo} />
        )}
      </TabsContent>
    </Tabs>
  )
}
