"use client"

import { useEffect, useState, type ComponentType } from "react"
import type { CandidatoProfileTabId } from "@/lib/candidato-profile-tabs"
import type { FichaCandidato } from "@/lib/types"

type CandidatoProfileProps = {
  ficha: FichaCandidato
  initialTab?: CandidatoProfileTabId
}

type ProfileComponent = ComponentType<CandidatoProfileProps>
type DeferredProfileOverview = {
  processos: number
  patrimonio: number | null
  mudancas: number
}

const MOBILE_DEFER_TIMEOUT_MS = 4000

function formatOverviewNumber(value: number | null) {
  if (value === null) return "N/D"
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function useDeferredBelowFoldLoad() {
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    if (!window.matchMedia("(max-width: 640px)").matches) {
      const frame = window.requestAnimationFrame(() => setShouldLoad(true))
      return () => window.cancelAnimationFrame(frame)
    }

    const timeout = window.setTimeout(() => setShouldLoad(true), MOBILE_DEFER_TIMEOUT_MS)
    const onScroll = () => {
      setShouldLoad(true)
    }
    window.addEventListener("scroll", onScroll, { once: true, passive: true })
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return shouldLoad
}

function CandidatoProfileSkeleton({ overview }: { overview: DeferredProfileOverview }) {
  return (
    <section className="mx-auto max-w-7xl px-5 py-8 md:px-12 lg:py-12">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border/50 bg-card px-4 py-3">
          <span
            data-pf-overview-processos={overview.processos}
            data-pf-overview-raw={overview.processos}
            className="text-[24px] font-semibold leading-none text-foreground sm:text-[28px]"
          >
            {overview.processos}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground sm:text-[11px]">
            Processos
          </span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border/50 bg-card px-4 py-3">
          <span
            data-pf-overview-patrimonio={formatOverviewNumber(overview.patrimonio)}
            data-pf-overview-raw={overview.patrimonio ?? undefined}
            className="text-[24px] font-semibold leading-none text-foreground sm:text-[28px]"
          >
            {formatOverviewNumber(overview.patrimonio)}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground sm:text-[11px]">
            Patrimônio
          </span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border/50 bg-card px-4 py-3">
          <span
            data-pf-overview-mudancas={overview.mudancas}
            data-pf-overview-raw={overview.mudancas}
            className="text-[24px] font-semibold leading-none text-foreground sm:text-[28px]"
          >
            {overview.mudancas}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground sm:text-[11px]">
            Trocas de partido
          </span>
        </div>
      </div>
      <div className="mt-6 h-12 rounded-[8px] border border-border bg-muted/25" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 rounded-[8px] border border-border bg-muted/25" />
        ))}
      </div>
    </section>
  )
}

function CandidatoProfileLoadError() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-8 md:px-12 lg:py-12">
      <div className="rounded-[8px] border border-border bg-muted/25 p-4 text-sm font-medium text-muted-foreground">
        Não foi possível carregar os detalhes desta ficha agora.
      </div>
    </section>
  )
}

async function fetchProfile(slug: string): Promise<FichaCandidato> {
  const response = await fetch(`/api/candidato-profile/${encodeURIComponent(slug)}`, {
    credentials: "same-origin",
  })

  if (!response.ok) {
    throw new Error(`profile_fetch_failed:${response.status}`)
  }

  const body = (await response.json()) as { data?: FichaCandidato | null }
  if (!body.data) {
    throw new Error("profile_fetch_empty")
  }
  return body.data
}

export function DeferredCandidatoProfileClient({
  slug,
  initialTab,
  overview,
}: {
  slug: string
  initialTab?: CandidatoProfileTabId
  overview: DeferredProfileOverview
}) {
  const shouldLoad = useDeferredBelowFoldLoad()
  const [Profile, setProfile] = useState<ProfileComponent | null>(null)
  const [ficha, setFicha] = useState<FichaCandidato | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!shouldLoad || (Profile && ficha) || failed) return
    let active = true

    Promise.all([
      import("@/components/CandidatoProfile").then((mod) => mod.CandidatoProfile as ProfileComponent),
      fetchProfile(slug),
    ])
      .then(([ProfileComponent, profileFicha]) => {
        if (!active) return
        setProfile(() => ProfileComponent)
        setFicha(profileFicha)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
    }
  }, [Profile, failed, ficha, shouldLoad, slug])

  if (failed) {
    return <CandidatoProfileLoadError />
  }

  return Profile && ficha ? (
    <Profile ficha={ficha} initialTab={initialTab} />
  ) : (
    <CandidatoProfileSkeleton overview={overview} />
  )
}
