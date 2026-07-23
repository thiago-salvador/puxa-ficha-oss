"use client"

import { useCallback, useMemo, useState } from "react"
import { SITE_ORIGIN } from "@/lib/metadata"
import { formatPartyPublicLabel } from "@/lib/party-utils"

export interface EmbedCodeGeneratorCandidate {
  slug: string
  nome_urna: string
  partido_sigla: string
}

const RESIZE_SNIPPET = `window.addEventListener("message", function (e) {
  if (e.origin !== "${SITE_ORIGIN}") return
  if (e.data?.type !== "puxaficha:resize" || typeof e.data.height !== "number") return
  var el = document.getElementById("puxaficha-embed-iframe")
  if (el) el.style.height = e.data.height + "px"
})`

export function EmbedCodeGenerator({ candidates }: { candidates: EmbedCodeGeneratorCandidate[] }) {
  const [query, setQuery] = useState("")
  const [slug, setSlug] = useState(candidates[0]?.slug ?? "")
  const [copied, setCopied] = useState<"html" | "script" | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      (c) =>
        c.slug.toLowerCase().includes(q) ||
        c.nome_urna.toLowerCase().includes(q) ||
        c.partido_sigla.toLowerCase().includes(q),
    )
  }, [candidates, query])

  const embedSrc = slug ? `${SITE_ORIGIN}/embed/${slug}` : ""
  const iframeHtml = `<iframe id="puxaficha-embed-iframe" src="${embedSrc}" width="400" height="480" style="max-width:100%;border:0" title="Puxa Ficha, resumo do candidato"></iframe>`

  const copy = useCallback(async (text: string, kind: "html" | "script") => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <label htmlFor="embed-search" className="mb-2 block text-[13px] font-semibold text-foreground">
          Buscar candidato
        </label>
        <input
          id="embed-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome, partido ou slug"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px]"
        />
      </div>

      <div>
        <label htmlFor="embed-select" className="mb-2 block text-[13px] font-semibold text-foreground">
          Candidato
        </label>
        <select
          id="embed-select"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px]"
        >
          {filtered.map((c) => {
            const partyLabel = formatPartyPublicLabel(c.partido_sigla)
            return (
              <option key={c.slug} value={c.slug}>
                {partyLabel
                  ? `${c.nome_urna} (${partyLabel}) | ${c.slug}`
                  : `${c.nome_urna} | ${c.slug}`}
              </option>
            )
          })}
        </select>
      </div>

      {embedSrc ? (
        <div>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-muted/30 p-2">
            <iframe
              src={embedSrc}
              width={400}
              height={480}
              className="max-w-full border-0"
              title="Preview do embed"
            />
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            HTML do iframe
          </h2>
          <button
            type="button"
            onClick={() => copy(iframeHtml, "html")}
            className="rounded-full border border-foreground px-4 py-1.5 text-[12px] font-bold uppercase tracking-wide"
          >
            {copied === "html" ? "Copiado" : "Copiar"}
          </button>
        </div>
        <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-card p-3 text-[12px] leading-relaxed">
          {iframeHtml}
        </pre>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            Script opcional (altura automatica)
          </h2>
          <button
            type="button"
            onClick={() => copy(RESIZE_SNIPPET, "script")}
            className="rounded-full border border-foreground px-4 py-1.5 text-[12px] font-bold uppercase tracking-wide"
          >
            {copied === "script" ? "Copiado" : "Copiar"}
          </button>
        </div>
        <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-card p-3 text-[12px] leading-relaxed">
          {RESIZE_SNIPPET}
        </pre>
        <p className="mt-2 text-[12px] text-muted-foreground">
          O script valida a origem das mensagens. Use o mesmo{" "}
          <code className="rounded bg-muted px-1">id</code> no iframe.
        </p>
      </div>
    </div>
  )
}
