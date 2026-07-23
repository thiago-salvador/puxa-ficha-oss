"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"
import type { FichaCandidato, ProjetoLei } from "@/lib/types"
import { classifyAttentionPoints } from "@/lib/attention-points"
import { formatCompact, formatDate, safeHref } from "@/lib/utils"
import { ProfileTabs, type Tab } from "./ProfileTabs"
import { GravityBadge } from "./GravityBadge"
import { NewsSection } from "./NewsSection"
import { SectionLabel, SectionTitle } from "./SectionHeader"
import { ProfileOverview } from "./ProfileOverview"
import { StateIndicators } from "./StateIndicators"
import {
  EmptyState,
  getProcessosEmptyState,
  getVotosEmptyState,
} from "./EmptyState"
import type { CandidatoProfileNavTabId, CandidatoProfileTabId } from "@/lib/candidato-profile-tabs"
import {
  CANDIDATO_PROFILE_NAV_TAB_IDS,
  normalizeCandidatoProfileNavTab,
  normalizeCandidatoProfileTab,
} from "@/lib/candidato-profile-tabs"
import type { TimelineNavigateOptions } from "./timeline/TimelineTooltip"
import { buildTimelineEvents } from "@/lib/timeline-utils"
import { groupLegislacaoProfileItems } from "@/lib/legislacao-profile-groups"
import { FollowCandidateButton } from "./alerts/FollowCandidateButton"
import { EditorialBadge } from "./attention-points/EditorialBadge"
import {
  FONTES_LINK_CLASS_ALERTAS,
  FONTES_LINK_CLASS_POSITIVOS,
} from "./attention-points/fontes-link-classes"
import { FontesList } from "./attention-points/FontesList"
import { MetaBadge } from "./MetaBadge"
import { NoticePanel } from "./NoticePanel"
import {
  fixedCopy,
  formatAttentionCategoryLabel,
  formatProcessStatusLabel,
  formatProcessTypeLabel,
  formatTemaLabel,
  formatVoteBadgeLabel,
} from "@/lib/ui-labels"
import { sanitizePtBrText } from "@/lib/ptbr-text"
import {
  mudancasPartidoLinhasPublicas,
  prepareHistoricoPoliticoPublicDisplayList,
  profileTrajetoriaTabBadgeCount,
} from "@/lib/trajetoria-public-display"
import { hasSameYearPartyReversal } from "@/lib/party-switches"
import { hasWideManualOverlappingSegmentedMandates } from "@/lib/historico-dedupe"
import { hasLegislativeHistory as detectLegislativeHistory } from "@/lib/legislative-history"
import {
  Scale,
  Landmark,
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  FileText,
} from "lucide-react"

// --- Dynamic imports: tabs that are NOT visible on first paint ---
function TabSkeleton() {
  return <div className="animate-pulse space-y-4 py-4"><div className="h-5 w-1/3 rounded bg-muted" /><div className="h-4 w-full rounded bg-muted" /><div className="h-4 w-2/3 rounded bg-muted" /></div>
}

const MoneyTabSection = dynamic(
  () => import("./CandidatoProfileSections").then((m) => ({ default: m.MoneyTabSection })),
  { loading: TabSkeleton },
)
const TrajectoryTabSection = dynamic(
  () => import("./CandidatoProfileSections").then((m) => ({ default: m.TrajectoryTabSection })),
  { loading: TabSkeleton },
)
const LegislationTabSection = dynamic(
  () => import("./CandidatoProfileSections").then((m) => ({ default: m.LegislationTabSection })),
  { loading: TabSkeleton },
)
const VotingDots = dynamic(
  () => import("./VotingDots").then((m) => ({ default: m.VotingDots })),
  { loading: () => <div className="h-8" /> },
)
// Timeline é a única aba pesada que carregava estática (puxa gsap + ScrollTrigger,
// ~120KB, para dentro do chunk do perfil mesmo quando o visitante nunca abre a aba).
// dynamic() move esse engine para um chunk buscado só quando a aba "timeline" abre,
// alinhando com as outras 4 abas condicionais.
const TimelineTab = dynamic(
  () => import("./timeline/TimelineTab").then((m) => ({ default: m.TimelineTab })),
  { loading: TabSkeleton },
)

function attentionRailColor(gravidade: string) {
  if (gravidade === "critica") return "#dc2626"
  if (gravidade === "alta") return "#f97316"
  if (gravidade === "media") return "#f59e0b"
  return "#d4d4d4"
}

const StatCard = memo(function StatCard({
  value,
  label,
  icon: Icon,
  alert,
  sub,
  trend,
  dataValueAttr,
  dataRawValue,
}: {
  value: string | number
  label: string
  icon: React.ComponentType<{ className?: string }>
  alert?: boolean
  sub?: string
  trend?: { value: string; positive?: boolean }
  dataValueAttr?: string
  dataRawValue?: string | number | null
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[12px] border border-border/50 bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span
          {...(dataValueAttr ? { [dataValueAttr]: String(value) } : {})}
          data-pf-overview-raw={dataRawValue ?? undefined}
          className="font-heading text-[24px] leading-none tracking-tight text-foreground sm:text-[28px] lg:text-[32px]"
        >
          {value}
        </span>
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-[0.08em] sm:text-[11px] ${alert ? "text-red-600" : "text-muted-foreground"}`}>
        {label}
      </span>
      {(sub || trend) && (
        <span className={`text-[10px] font-semibold sm:text-[11px] ${trend?.positive === false ? "text-red-600" : trend?.positive ? "text-green-700" : "text-muted-foreground"}`}>
          {trend ? `${trend.positive === false ? "↓ " : trend.positive ? "↑ " : ""}${trend.value}` : sub}
        </span>
      )}
    </div>
  )
})

function resolveInitialTab(tab: CandidatoProfileTabId | undefined): CandidatoProfileTabId {
  return normalizeCandidatoProfileTab(tab) ?? "geral"
}

function subscribeToLocationSearch(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener("popstate", onStoreChange)
  window.addEventListener("hashchange", onStoreChange)
  window.addEventListener("puxa-ficha:location-search-change", onStoreChange)
  return () => {
    window.removeEventListener("popstate", onStoreChange)
    window.removeEventListener("hashchange", onStoreChange)
    window.removeEventListener("puxa-ficha:location-search-change", onStoreChange)
  }
}

function getLocationSearchSnapshot(): string {
  if (typeof window === "undefined") return ""
  return window.location.search
}

function getServerLocationSearchSnapshot(): string {
  return ""
}

function pushProfileTabUrl(tabId: CandidatoProfileNavTabId) {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  if (url.pathname.endsWith("/timeline")) {
    url.pathname = url.pathname.replace(/\/timeline\/?$/, "")
  }
  url.searchParams.set("tab", tabId)
  window.history.pushState({ profileTab: tabId }, "", `${url.pathname}${url.search}${url.hash}`)
  window.dispatchEvent(new Event("puxa-ficha:location-search-change"))
}

async function fetchAllProjetosLei(slug: string, signal: AbortSignal): Promise<ProjetoLei[]> {
  const pageSize = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  const rows: ProjetoLei[] = []

  while (offset < total) {
    const response = await fetch(
      `/api/candidato-profile/${encodeURIComponent(slug)}/projetos-lei?offset=${offset}&limit=${pageSize}`,
      { credentials: "same-origin", signal },
    )
    if (!response.ok) throw new Error(`projetos_lei_fetch_failed:${response.status}`)
    const body = (await response.json()) as {
      data?: { rows?: ProjetoLei[]; total?: number } | null
    }
    if (!body.data || !Array.isArray(body.data.rows)) {
      throw new Error("projetos_lei_fetch_empty")
    }
    total = Math.max(0, body.data.total ?? body.data.rows.length)
    rows.push(...body.data.rows)
    if (body.data.rows.length === 0) break
    offset += body.data.rows.length
  }

  if (rows.length < total) throw new Error("projetos_lei_fetch_incomplete")
  return rows
}

export function CandidatoProfile({
  ficha,
  initialTab,
}: {
  ficha: FichaCandidato
  /** Definido no servidor (`?tab=` ou rota `/timeline`). */
  initialTab?: CandidatoProfileTabId
}) {
  // Null-safe arrays (Supabase can return null for empty relations)
  const patrimonio = ficha.patrimonio ?? []
  const financiamento = ficha.financiamento ?? []
  const processos = ficha.processos ?? []
  const votos = ficha.votos ?? []
  const historico = ficha.historico ?? []
  const mudancas = ficha.mudancas_partido ?? []
  const historicoDescartado = ficha.historico_descartado ?? 0
  const timelinePartidariaIncompleta = ficha.timeline_partidaria_incompleta ?? false
  const pontosAtencao = ficha.pontos_atencao ?? []
  const projetosLeiPreview = ficha.projetos_lei ?? []
  const projetosLeiTotal = ficha.projetos_lei_total ?? projetosLeiPreview.length
  const [projetosLei, setProjetosLei] = useState(projetosLeiPreview)
  const [projetosLeiLoadState, setProjetosLeiLoadState] = useState<"idle" | "loading" | "loaded" | "failed">(
    ficha.projetos_lei_truncados ? "idle" : "loaded",
  )
  const projetosLeiLoadStateRef = useRef(projetosLeiLoadState)
  const legislacaoMandatoExecutivo = ficha.legislacao_mandato_executivo ?? []
  const hasLegislativeHistory = detectLegislativeHistory(historico)
  const legislacaoGroups = groupLegislacaoProfileItems({
    projetosLei,
    legislacaoMandatoExecutivo,
    votos,
    cargoDisputado: ficha.cargo_disputado,
  })
  const gastos = ficha.gastos_parlamentares ?? []
  const sectionFreshness = ficha.section_freshness ?? {}
  const { alertasGraves, alertasNaoPositivos, pontosPositivos } = classifyAttentionPoints(pontosAtencao)
  const attentionSourceLinkCount = pontosAtencao.reduce(
    (total, ponto) => total + (ponto.fontes ?? []).filter((fonte) => safeHref(fonte.url)).length,
    0,
  )
  const curationVerifiedCount = pontosAtencao.filter((ponto) => ponto.verificado === true).length

  const tabDefsById: Record<CandidatoProfileNavTabId, { label: string; dataCount: number }> = {
    geral: { label: fixedCopy.generalOverview, dataCount: 0 },
    dinheiro: { label: "Dinheiro", dataCount: patrimonio.length + financiamento.length + gastos.length },
    justica: { label: "Justiça", dataCount: processos.length },
    votos: { label: "Votos", dataCount: votos.length },
    trajetoria: { label: "Trajetória", dataCount: profileTrajetoriaTabBadgeCount(historico, mudancas) },
    legislacao: {
      label: "Legislação",
      dataCount: legislacaoGroups.navigationCount + Math.max(0, projetosLeiTotal - projetosLei.length),
    },
    alertas: { label: "Alertas", dataCount: pontosAtencao.length },
  }

  const tabDefs: { id: CandidatoProfileNavTabId; label: string; dataCount: number }[] =
    CANDIDATO_PROFILE_NAV_TAB_IDS.map((id) => ({ id, ...tabDefsById[id] }))

  const locationSearch = useSyncExternalStore(
    subscribeToLocationSearch,
    getLocationSearchSnapshot,
    getServerLocationSearchSnapshot,
  )
  const tabParam = new URLSearchParams(locationSearch).get("tab") ?? undefined
  // O tab da URL sempre vence quando presente. `initialTab` (vindo do server, ex.
  // rota /candidato/[slug]/timeline) e apenas o fallback do primeiro paint, quando
  // ainda nao ha ?tab. Gatear urlSelectedTab em `initialTab === undefined` travava a
  // navegacao por tabs na rota /timeline (review 2026-06-09).
  const urlSelectedTab = normalizeCandidatoProfileNavTab(tabParam)
  const activeTab = urlSelectedTab ?? resolveInitialTab(initialTab)
  const [tabHighlightRef, setTabHighlightRef] = useState<string | null>(null)
  const tabContentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeTab !== "legislacao" || projetosLeiLoadStateRef.current !== "idle") return
    const controller = new AbortController()
    projetosLeiLoadStateRef.current = "loading"
    setProjetosLeiLoadState("loading")
    fetchAllProjetosLei(ficha.slug, controller.signal)
      .then((rows) => {
        setProjetosLei(rows)
        projetosLeiLoadStateRef.current = "loaded"
        setProjetosLeiLoadState("loaded")
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        projetosLeiLoadStateRef.current = "failed"
        setProjetosLeiLoadState("failed")
      })
    return () => controller.abort()
  }, [activeTab, ficha.slug])

  const navigateToTab = useCallback((tabId: string, opts?: TimelineNavigateOptions) => {
    const next = normalizeCandidatoProfileNavTab(tabId)
    if (!next) return
    pushProfileTabUrl(next)
    if (opts?.timelineEventId) {
      setTabHighlightRef(opts.timelineEventId)
    } else {
      setTabHighlightRef(null)
    }
  }, [])

  // Scroll tab content into view after React commits the new tab DOM
  useEffect(() => {
    // Skip if highlight scroll will handle positioning
    if (tabHighlightRef) return
    const el = tabContentRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Only scroll when content top is above the visible area (sticky navbar 64px + tabs ~56px)
    if (rect.top < 120) {
      const targetY = window.scrollY + rect.top - 128
      window.scrollTo({ top: Math.max(0, targetY), behavior: "instant" })
    }
  }, [activeTab, tabHighlightRef])

  useLayoutEffect(() => {
    if (!tabHighlightRef) return undefined
    let cancelled = false
    let timer: number | undefined
    let targetEl: HTMLElement | null = null

    const run = () => {
      try {
        targetEl = document.querySelector(
          `[data-pf-timeline-ref="${CSS.escape(tabHighlightRef)}"]`,
        ) as HTMLElement | null
      } catch {
        targetEl = document.querySelector(`[data-pf-timeline-ref="${tabHighlightRef}"]`) as HTMLElement | null
      }
      if (!targetEl) {
        if (!cancelled) setTabHighlightRef(null)
        return
      }
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" })
      targetEl.classList.add("ring-2", "ring-foreground", "ring-offset-2", "rounded-[12px]")
      timer = window.setTimeout(() => {
        if (cancelled || !targetEl) return
        targetEl.classList.remove("ring-2", "ring-foreground", "ring-offset-2", "rounded-[12px]")
        setTabHighlightRef(null)
      }, 4200)
    }

    const id = requestAnimationFrame(() => requestAnimationFrame(run))
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
      if (timer) clearTimeout(timer)
      if (targetEl) {
        targetEl.classList.remove("ring-2", "ring-foreground", "ring-offset-2", "rounded-[12px]")
      }
    }
  }, [activeTab, tabHighlightRef])

  const tabs: Tab[] = tabDefs.map((t) => ({
    id: t.id,
    label: t.label,
    count: t.dataCount || undefined,
  }))

  const latestPatrimonio =
    patrimonio.length > 0
      ? [...patrimonio].sort((a, b) => b.ano_eleicao - a.ano_eleicao)[0]
      : null

  const patrimonioVariacao =
    patrimonio.length >= 2
      ? (() => {
          const sorted = [...patrimonio].sort((a, b) => b.ano_eleicao - a.ano_eleicao)
          const latest = sorted[0]
          const prev = sorted[1]
          const pct = prev.valor_total > 0
            ? ((latest.valor_total - prev.valor_total) / prev.valor_total) * 100
            : 0
          return { pct: Math.round(pct), from: prev.ano_eleicao, to: latest.ano_eleicao }
        })()
      : null

  const totalGastos =
    gastos.length > 0
      ? gastos.reduce((acc, g) => acc + g.total_gasto, 0)
      : null

  // For empty states: suggest navigating to a tab that has data
  function suggestFor(currentTabId: string): { label: string; go: () => void } | null {
    const other = tabDefs
      .filter((t) => t.id !== currentTabId && t.dataCount > 0)
      .sort((a, b) => b.dataCount - a.dataCount)[0]
    if (!other) return null
    return { label: `Ver ${other.label} (${other.dataCount})`, go: () => navigateToTab(other.id) }
  }

  // Bloco 7 do review 2026-04-24: emitir os contadores da aba Trajetória sempre
  // no HTML SSR (mesma condição/contagem da seção real), para que release-verify
  // (Playwright em /candidato/[slug]?tab=trajetoria) leia os atributos no primeiro
  // paint, sem depender da hidratação do client component que troca a aba.
  const trajectoryCountValue = !hasWideManualOverlappingSegmentedMandates(historico)
    ? prepareHistoricoPoliticoPublicDisplayList(historico).length
    : null
  const partySwitchCountValue =
    (mudancas.length > 0 || Boolean(ficha.partido_sigla) || Boolean(ficha.partido_atual)) &&
    !hasSameYearPartyReversal(mudancas)
      ? mudancasPartidoLinhasPublicas(mudancas)
      : null

  return (
    <>
      {historico.length > 0 && trajectoryCountValue !== null && (
        <span hidden aria-hidden="true" data-pf-trajetoria-count={trajectoryCountValue} />
      )}
      {partySwitchCountValue !== null && (
        <span hidden aria-hidden="true" data-pf-partidos-count={partySwitchCountValue} />
      )}
      {/* Stats strip */}
      <section className="mx-auto max-w-7xl px-5 py-4 sm:py-6 md:px-12">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
            <StatCard
              value={ficha.total_processos ?? 0}
              label="Processos"
              icon={Scale}
              dataValueAttr="data-pf-overview-processos"
              dataRawValue={ficha.total_processos ?? 0}
              sub={(ficha.processos_criminais ?? 0) > 0 ? `${ficha.processos_criminais} criminal` : undefined}
            />
            <StatCard
              value={latestPatrimonio ? formatCompact(latestPatrimonio.valor_total) : "N/D"}
              label="Patrimônio"
              icon={Landmark}
              dataValueAttr="data-pf-overview-patrimonio"
              dataRawValue={latestPatrimonio?.valor_total ?? null}
              trend={patrimonioVariacao ? {
                value: `${Math.abs(patrimonioVariacao.pct)}% (${patrimonioVariacao.from}-${patrimonioVariacao.to})`,
                positive: patrimonioVariacao.pct > 0 ? undefined : false,
              } : undefined}
            />
            <StatCard
              value={ficha.total_mudancas_partido ?? 0}
              label="Trocas de partido"
              icon={ArrowRightLeft}
              dataValueAttr="data-pf-overview-mudancas"
              dataRawValue={ficha.total_mudancas_partido ?? 0}
            />
            <StatCard
              value={alertasGraves.length}
              label="Alertas graves"
              icon={AlertTriangle}
              alert={alertasGraves.length > 0}
            />
            {projetosLei.length > 0 ? (
            <StatCard
              value={projetosLei.length}
              label="Projetos de lei"
              icon={FileText}
              sub={`${projetosLei.filter(p => p.destaque).length} em destaque`}
            />
            ) : (
            <div
              className="min-w-0"
              title="Soma de total_gasto em todos os anos com registro CEAP nesta ficha. Na visão geral, o cartão de cota parlamentar destaca o ano mais recente com dados."
            >
            <StatCard
              value={totalGastos != null ? formatCompact(totalGastos) : "N/D"}
              label="Gastos CEAP"
              icon={Banknote}
              sub={gastos.length > 0 ? `Soma total · ${gastos.length} ano${gastos.length > 1 ? "s" : ""}` : undefined}
            />
            </div>
            )}
        </div>
      </section>


      {/* Tab navigation */}
      {tabs.length > 0 && (
        <>
          <ProfileTabs tabs={tabs} activeTab={activeTab} onTabChange={navigateToTab} />

          <div
            ref={tabContentRef}
            id={`profile-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={(CANDIDATO_PROFILE_NAV_TAB_IDS as readonly string[]).includes(activeTab) ? `profile-tab-${activeTab}` : undefined}
            className="mx-auto max-w-7xl scroll-mt-32 px-5 py-8 outline-none sm:py-12 md:px-12 lg:py-16"
          >
            {/* VISAO GERAL TAB */}
            {activeTab === "geral" && (
              <div className="space-y-12">
                <ProfileOverview ficha={ficha} onNavigateTab={navigateToTab} />
                {ficha.cargo_disputado === "Governador" && (ficha.indicadores_estaduais ?? []).length > 0 && (
                  <StateIndicators indicadores={ficha.indicadores_estaduais!} estado={ficha.estado ?? ""} />
                )}
                <FollowCandidateButton
                  candidateName={ficha.nome_urna}
                  candidateSlug={ficha.slug}
                />

                {ficha.noticias && ficha.noticias.length > 0 && (
                  <NewsSection noticias={ficha.noticias} />
                )}
              </div>
            )}

            {/* TIMELINE TAB */}
            {activeTab === "timeline" && (
              <TimelineTab
                ficha={ficha}
                events={buildTimelineEvents(ficha)}
                onTabNavigate={navigateToTab}
                suggest={suggestFor("timeline")}
              />
            )}

            {/* DINHEIRO TAB */}
            {activeTab === "dinheiro" && (
              <MoneyTabSection
                patrimonio={patrimonio}
                financiamento={financiamento}
                historico={historico}
                gastos={gastos}
                historicoLength={historico.length}
                suggestion={suggestFor("dinheiro")}
                highlightTimelineRef={tabHighlightRef}
                freshness={{
                  patrimonio: sectionFreshness.patrimonio,
                  financiamento: sectionFreshness.financiamento,
                  gastos_parlamentares: sectionFreshness.gastos_parlamentares,
                }}
              />
            )}

            {/* JUSTICA TAB */}
            {activeTab === "justica" && (
              <div>
                <SectionLabel>Processos judiciais ({processos.length})</SectionLabel>
                <SectionTitle>{fixedCopy.justiceSituation}</SectionTitle>
                {processos.length === 0 && (() => { const s = suggestFor("justica"); return <EmptyState {...getProcessosEmptyState()} suggestLabel={s?.label} onSuggest={s?.go} /> })()}
                {/* Group by type */}
                {(["criminal", "improbidade", "eleitoral", "civil"] as const).map((tipo) => {
                  const grouped = processos.filter((p) => p.tipo === tipo)
                  if (grouped.length === 0) return null
                  return (
                    <div key={tipo} className="mt-6">
                      <h3 className="mb-3 text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        {formatProcessTypeLabel(tipo)} ({grouped.length})
                      </h3>
                      <div className="space-y-3">
                        {grouped.map((p) => (
                          <div
                            key={p.id}
                            data-pf-timeline-ref={`processo-${p.id}`}
                            className="rounded-[12px] border border-border/50 border-l-[3px] px-5 py-4"
                            style={{
                              borderLeftColor: p.gravidade === "alta" ? "#dc2626" : p.gravidade === "media" ? "#f59e0b" : "#d4d4d4",
                            }}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <GravityBadge gravidade={p.gravidade} />
                              <MetaBadge tone="muted">
                                {formatProcessStatusLabel(p.status)}
                              </MetaBadge>
                              {p.data_inicio && (
                                <span className="text-[10px] font-semibold text-muted-foreground">
                                  Desde {formatDate(p.data_inicio)}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-[length:var(--text-body)] font-medium leading-snug text-foreground">
                              {p.descricao}
                            </p>
                            {p.tribunal && (
                              <p className="mt-1 text-[length:var(--text-caption)] font-semibold text-muted-foreground">
                                {p.tribunal} {p.numero_processo ? `| ${p.numero_processo}` : ""}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* VOTOS TAB */}
            {activeTab === "votos" && (
              <div>
                <SectionLabel>{fixedCopy.keyVotes} ({votos.length})</SectionLabel>
                <SectionTitle>Como votou em temas importantes</SectionTitle>
                {/* Visual dot grid */}
                {votos.length > 0 && (
                  <div className="mt-6">
                    <VotingDots votos={votos} />
                  </div>
                )}
                {votos.length === 0 && (() => { const s = suggestFor("votos"); return <EmptyState {...getVotosEmptyState(hasLegislativeHistory)} suggestLabel={s?.label} onSuggest={s?.go} /> })()}
                <div className="mt-6 space-y-3">
                  {votos.map((v) => (
                    <div
                      key={v.id}
                      data-pf-voto-card
                      data-pf-voto-id={v.votacao_id}
                      data-pf-voto-date={v.votacao?.data_votacao ?? ""}
                      data-pf-voto-title={v.votacao?.titulo ?? ""}
                      data-pf-timeline-ref={`voto-${v.id}`}
                      className={`rounded-[12px] border border-border/50 bg-card px-5 py-4 ${
                        v.contradicao ? "border-l-[3px] border-l-amber-400/80" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">
                            {v.votacao?.titulo ? sanitizePtBrText(v.votacao.titulo) : "Votação"}
                          </p>
                          {v.votacao?.descricao && (
                            <p className="mt-1 text-[length:var(--text-body-sm)] font-medium text-muted-foreground">
                              {sanitizePtBrText(v.votacao.descricao)}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {v.votacao?.tema && (
                              <MetaBadge tone="muted">
                                {formatTemaLabel(v.votacao.tema)}
                              </MetaBadge>
                            )}
                            {v.votacao?.casa && (
                              <span className="text-[10px] font-semibold text-muted-foreground">
                                {v.votacao.casa} | {v.votacao.data_votacao ? formatDate(v.votacao.data_votacao) : ""}
                              </span>
                            )}
                          </div>
                          {v.contradicao && v.contradicao_descricao && (
                            <div className="mt-3 border-l-2 border-amber-400/70 bg-muted/30 px-3 py-2.5">
                              <p className="text-[length:var(--text-caption)] font-bold uppercase tracking-[0.08em] text-foreground">
                                Contradição editorial
                              </p>
                              <p className="mt-1 text-[length:var(--text-caption)] font-semibold text-muted-foreground">
                                {sanitizePtBrText(v.contradicao_descricao)}
                              </p>
                            </div>
                          )}
                          {v.votacao?.impacto_popular && (
                            <p className="mt-1.5 text-[length:var(--text-caption)] font-medium text-muted-foreground">
                              Impacto: {v.votacao.impacto_popular}
                            </p>
                          )}
                        </div>
                        <span
                          className={`mt-1 shrink-0 rounded-full px-3.5 py-1.5 text-[length:var(--text-caption)] font-bold uppercase tracking-[0.05em] ${
                            v.voto === "sim"
                              ? "bg-foreground text-background"
                              : v.voto === "não"
                                ? "border border-foreground bg-transparent text-foreground"
                                : "bg-secondary text-foreground"
                          }`}
                        >
                          {formatVoteBadgeLabel(v.voto)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TRAJETORIA TAB */}
            {activeTab === "trajetoria" && (
              <TrajectoryTabSection
                historico={historico}
                mudancas={mudancas}
                historicoDescartado={historicoDescartado}
                timelinePartidariaIncompleta={timelinePartidariaIncompleta}
                partidoAtualSigla={ficha.partido_sigla}
                partidoAtualNome={ficha.partido_atual ? sanitizePtBrText(ficha.partido_atual) : null}
                suggestion={suggestFor("trajetoria")}
                freshness={{
                  historico_politico: sectionFreshness.historico_politico,
                  mudancas_partido: sectionFreshness.mudancas_partido,
                }}
              />
            )}

            {/* LEGISLACAO TAB */}
            {activeTab === "legislacao" && (
              <LegislationTabSection
                projetosLei={projetosLei}
                legislacaoMandatoExecutivo={legislacaoMandatoExecutivo}
                votos={votos}
                cargoDisputado={ficha.cargo_disputado}
                hasLegislativeHistory={hasLegislativeHistory}
                suggestion={suggestFor("legislacao")}
                freshness={sectionFreshness.projetos_lei}
                projetosLeiLoadState={projetosLeiLoadState}
                projetosLeiTotal={projetosLeiTotal}
              />
            )}

            {/* ALERTAS TAB */}
            {activeTab === "alertas" && (
              <div>
                <SectionLabel>{fixedCopy.attentionPointsAndHighlights} ({pontosAtencao.length})</SectionLabel>
                <SectionTitle>O que você precisa saber</SectionTitle>
                <div className="mt-6 space-y-8">
                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Alertas e Pontos de Atenção ({alertasNaoPositivos.length})
                      </h3>
                    </div>
                    {alertasNaoPositivos.length === 0 && (
                      <NoticePanel
                        tone="neutral"
                        rail={false}
                        description="Nenhum alerta negativo visível registrado no momento."
                      />
                    )}
                    {alertasNaoPositivos.map((p) => (
                      <div
                        key={p.id}
                        data-pf-timeline-ref={`ponto-${p.id}`}
                        className="rounded-[16px] border border-border/50 bg-card px-5 py-4"
                        style={{
                          borderLeftWidth: "3px",
                          borderLeftStyle: "solid",
                          borderLeftColor: attentionRailColor(p.gravidade),
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <GravityBadge gravidade={p.gravidade} />
                          <MetaBadge tone="muted">
                            {formatAttentionCategoryLabel(p.categoria)}
                          </MetaBadge>
                          <EditorialBadge geradoPor={p.gerado_por} verificado={p.verificado === true} />
                        </div>
                        <h4 className="mt-2 text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">
                          {sanitizePtBrText(p.titulo)}
                        </h4>
                        <p className="mt-1 text-[length:var(--text-body-sm)] font-medium leading-relaxed text-foreground">
                          {sanitizePtBrText(p.descricao)}
                        </p>
                        <FontesList fontes={p.fontes} linkClass={FONTES_LINK_CLASS_ALERTAS} />
                      </div>
                    ))}
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Pontos positivos ({pontosPositivos.length})
                      </h3>
                    </div>
                    {pontosPositivos.length === 0 && (
                      <NoticePanel
                        tone="neutral"
                        rail={false}
                        description="Nenhum ponto positivo destacado no momento."
                      />
                    )}
                    {pontosPositivos.map((p) => (
                      <div
                        key={p.id}
                        data-pf-timeline-ref={`ponto-${p.id}`}
                        className="rounded-[16px] border border-border/50 bg-card px-5 py-4"
                        style={{
                          borderLeftWidth: "3px",
                          borderLeftStyle: "solid",
                          borderLeftColor: "#059669",
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <MetaBadge tone="positive">
                            Ponto positivo
                          </MetaBadge>
                          <EditorialBadge geradoPor={p.gerado_por} verificado={p.verificado === true} />
                        </div>
                        <h4 className="mt-2 text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">
                          {sanitizePtBrText(p.titulo)}
                        </h4>
                        <p className="mt-1 text-[length:var(--text-body-sm)] font-medium leading-relaxed text-foreground">
                          {sanitizePtBrText(p.descricao)}
                        </p>
                        <FontesList fontes={p.fontes} linkClass={FONTES_LINK_CLASS_POSITIVOS} />
                      </div>
                    ))}
                  </section>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {pontosAtencao.length > 0 && (
        <span
          hidden
          data-pf-editorial-badge-summary=""
          data-pf-editorial-badge-count={pontosAtencao.length}
          data-pf-curation-verified-count={curationVerifiedCount}
          data-pf-source-link-count={attentionSourceLinkCount}
        >
          Selos editoriais: {pontosAtencao.length}. Fontes verificáveis: {attentionSourceLinkCount}.
        </span>
      )}
    </>
  )
}
