"use client"

import { useEffect, useState, type ComponentType } from "react"

type ShareButtonsProps = {
  shareUrl: string
  title: string
  label?: string
  variant?: "card" | "compact"
  slug?: string
  candidateName?: string
}

type FollowCandidateButtonProps = {
  candidateName: string
  candidateSlug: string
  variant?: "card" | "compact"
}

type RecordVisitProps = {
  href: string
  title: string
  subtitle: string
  foto_url?: string | null
}

const MOBILE_DEFER_TIMEOUT_MS = 7000

function useDeferredClientWidgetLoad() {
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    if (!window.matchMedia("(max-width: 640px)").matches) {
      const frame = window.requestAnimationFrame(() => setShouldLoad(true))
      return () => window.cancelAnimationFrame(frame)
    }

    const timeout = window.setTimeout(() => setShouldLoad(true), MOBILE_DEFER_TIMEOUT_MS)
    const onIntent = () => setShouldLoad(true)
    window.addEventListener("scroll", onIntent, { once: true, passive: true })
    window.addEventListener("pointerdown", onIntent, { once: true, passive: true })
    window.addEventListener("keydown", onIntent, { once: true })
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener("scroll", onIntent)
      window.removeEventListener("pointerdown", onIntent)
      window.removeEventListener("keydown", onIntent)
    }
  }, [])

  return shouldLoad
}

export function DeferredShareButtons(props: ShareButtonsProps) {
  const shouldLoad = useDeferredClientWidgetLoad()
  const [ShareButtons, setShareButtons] = useState<ComponentType<ShareButtonsProps> | null>(null)

  useEffect(() => {
    if (!shouldLoad || ShareButtons) return
    let active = true
    void import("@/components/ShareButtons").then((mod) => {
      if (active) setShareButtons(() => mod.ShareButtons)
    })
    return () => {
      active = false
    }
  }, [ShareButtons, shouldLoad])

  if (ShareButtons) return <ShareButtons {...props} />

  return props.variant === "compact" ? (
    <div className="h-10 w-40 rounded-full border border-border bg-muted/20" aria-hidden="true" />
  ) : (
    <div className="h-28 rounded-[8px] border border-border bg-muted/20" aria-hidden="true" />
  )
}

export function DeferredFollowCandidateButton(props: FollowCandidateButtonProps) {
  const shouldLoad = useDeferredClientWidgetLoad()
  const [FollowCandidateButton, setFollowCandidateButton] =
    useState<ComponentType<FollowCandidateButtonProps> | null>(null)

  useEffect(() => {
    if (!shouldLoad || FollowCandidateButton) return
    let active = true
    void import("@/components/alerts/FollowCandidateButton").then((mod) => {
      if (active) setFollowCandidateButton(() => mod.FollowCandidateButton)
    })
    return () => {
      active = false
    }
  }, [FollowCandidateButton, shouldLoad])

  if (FollowCandidateButton) return <FollowCandidateButton {...props} />

  return <div className="h-10 w-40 rounded-full border border-border bg-muted/20" aria-hidden="true" />
}

export function DeferredRecordGlobalSearchRecentVisit({
  href,
  title,
  subtitle,
  foto_url,
}: RecordVisitProps) {
  const shouldLoad = useDeferredClientWidgetLoad()

  useEffect(() => {
    if (!shouldLoad) return
    let active = true
    void import("@/lib/global-search-recents").then((mod) => {
      if (!active) return
      mod.recordRecentCandidateVisit({ href, title, subtitle, foto_url })
    })
    return () => {
      active = false
    }
  }, [foto_url, href, shouldLoad, subtitle, title])

  return null
}
