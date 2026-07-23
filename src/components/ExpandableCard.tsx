"use client"

import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"

export function ExpandableCard({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <div className="rounded-[12px] border border-border/50 sm:rounded-[16px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5 sm:py-4"
      >
        <div>
          <div className="text-[length:var(--text-body)] font-bold text-foreground sm:text-[15px]">{title}</div>
          {subtitle && (
            <div className="mt-0.5 text-[length:var(--text-caption)] font-semibold text-muted-foreground sm:text-[length:var(--text-body-sm)]">
              {subtitle}
            </div>
          )}
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={panelId} className="border-t border-border/50 px-4 py-3 sm:px-5 sm:py-4">
          {children}
        </div>
      )}
    </div>
  )
}
