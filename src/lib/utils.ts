import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { REMOTE_IMAGE_HOSTS } from "./remote-image-hosts"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const PUBLIC_DATE_TIME_ZONE = "America/Sao_Paulo"

export function formatBRL(value: number): string {
  return brlFormatter.format(value)
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: PUBLIC_DATE_TIME_ZONE,
})

export function formatDate(date: string | Date): string {
  if (typeof date === "string") {
    // Bare YYYY-MM-DD strings represent calendar dates, so keep them stable without timezone math.
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (match) {
      const year = Number(match[1])
      const month = Number(match[2])
      const day = Number(match[3])
      const parsed = new Date(Date.UTC(year, month - 1, day))
      const isValidCalendarDate =
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      return isValidCalendarDate ? `${match[3]}/${match[2]}/${match[1]}` : "Data indisponível"
    }
  }
  const parsed = typeof date === "string" ? new Date(date) : date
  return Number.isNaN(parsed.getTime()) ? "Data indisponível" : dateFormatter.format(parsed)
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}K`
  return formatBRL(value)
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export const FALLBACK_GRADIENT = "linear-gradient(160deg, #1a1a1a 0%, #000000 100%)"

const KNOWN_PARTIES = [
  "pt",
  "pl",
  "psb",
  "psd",
  "psol",
  "mdb",
  "pp",
  "republicanos",
  "novo",
  "pcdob",
  "dem",
  "pstu",
  "pco",
  "missao",
  "up",
  "avante",
  "mobiliza",
  "pcb",
  "pode",
  "dc",
  "pdt",
  "psdb",
  "uniao",
]

const REMOTE_PARTY_LOGOS: Record<string, string> = {
  mobiliza:
    "https://upload.wikimedia.org/wikipedia/commons/7/7f/Logomarca_Partido_Mobiliza.png",
  pmn: "https://upload.wikimedia.org/wikipedia/commons/7/7f/Logomarca_Partido_Mobiliza.png",
  pcb: "https://upload.wikimedia.org/wikipedia/commons/d/d5/PCB_Logo.svg",
  pode: "https://upload.wikimedia.org/wikipedia/commons/2/2d/Podemos_%28Brasil%29_logo.svg",
  podemos:
    "https://upload.wikimedia.org/wikipedia/commons/2/2d/Podemos_%28Brasil%29_logo.svg",
}

/** Returns the URL only if it uses http or https protocol. Blocks javascript: and other schemes. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url, "https://placeholder.invalid")
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url
    return null
  } catch {
    return null
  }
}

export function getPartyLogoUrl(sigla: string): string | null {
  const normalized = sigla.toLowerCase().replace(/\s/g, "")
  const remoteLogo = REMOTE_PARTY_LOGOS[normalized]
  if (remoteLogo) return remoteLogo
  if (KNOWN_PARTIES.includes(normalized)) return `/partidos/${normalized}.png`
  return null
}

const OPTIMIZABLE_HOSTS = new Set<string>(REMOTE_IMAGE_HOSTS)

// Include Supabase storage host when configured
const _sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (_sbUrl && !_sbUrl.includes("placeholder")) {
  try { OPTIMIZABLE_HOSTS.add(new URL(_sbUrl).hostname) } catch { /* ignore bad env */ }
}

/**
 * Returns true when a URL points to a host that next/image should not proxy.
 * Relative URLs and most known hosts return false (let the optimizer handle them).
 */
export function shouldBypassImageOptimization(url: string | null | undefined): boolean {
  if (!url) return false

  try {
    const parsed = new URL(url, "https://placeholder.invalid")
    if (parsed.hostname === "placeholder.invalid") return false
    return !OPTIMIZABLE_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

export function getWikimediaThumbnailUrl(url: string, width: number): string {
  const targetWidth = Math.min(Math.max(Math.round(width), 64), 640)
  const normalizedWidth =
    [120, 250, 330, 500, 960].find((candidateWidth) => candidateWidth >= targetWidth) ?? 960

  try {
    const parsed = new URL(url)
    if (parsed.hostname !== "upload.wikimedia.org") return url

    const parts = parsed.pathname.split("/")
    const filename = parts.at(-1)
    if (!filename) return url

    const match = filename.match(/^\d+px-(.+)$/)
    if (!match) return url

    parts[parts.length - 1] = `${normalizedWidth}px-${match[1]}`
    parsed.pathname = parts.join("/")
    return parsed.toString()
  } catch {
    return url
  }
}
