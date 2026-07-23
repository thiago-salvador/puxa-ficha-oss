"use client"

import { useEffect, useRef, useState } from "react"
import { gsap } from "gsap"
import type { QuizPergunta, RespostaLikert } from "@/data/quiz/perguntas"
import { cn } from "@/lib/utils"

const OPTIONS: { value: RespostaLikert; label: string }[] = [
  { value: "concordo_total", label: "Concordo totalmente" },
  { value: "concordo_parcial", label: "Concordo em parte" },
  { value: "neutro", label: "Neutro ou sem opinião" },
  { value: "discordo_parcial", label: "Discordo em parte" },
  { value: "discordo_total", label: "Discordo totalmente" },
]

interface QuizQuestionProps {
  pergunta: QuizPergunta
  initialAnswer?: { valor: RespostaLikert; importante: boolean }
  onSubmit: (valor: RespostaLikert, importante: boolean) => void
  onBack?: (valor: RespostaLikert | null, importante: boolean) => void
  reducedMotion: boolean
}

export function QuizQuestion({ pergunta, initialAnswer, onSubmit, onBack, reducedMotion }: QuizQuestionProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [likert, setLikert] = useState<RespostaLikert | null>(initialAnswer?.valor ?? null)
  const [importante, setImportante] = useState(initialAnswer?.importante ?? false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A new quiz question must restore its persisted answer.
    setLikert(initialAnswer?.valor ?? null)
    setImportante(initialAnswer?.importante ?? false)
  }, [initialAnswer?.importante, initialAnswer?.valor, pergunta.id])

  useEffect(() => {
    const el = rootRef.current
    if (!el || reducedMotion) return
    gsap.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" })
  }, [pergunta.id, reducedMotion])

  const headingId = `quiz-pergunta-${pergunta.id}`

  return (
    <div ref={rootRef} className="space-y-6">
      <h2 id={headingId} className="text-lg font-medium leading-snug text-foreground md:text-xl">
        {pergunta.texto}
      </h2>
      {pergunta.contexto ? (
        <details className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">Entenda melhor</summary>
          <p className="mt-2 text-muted-foreground">{pergunta.contexto}</p>
        </details>
      ) : null}
      <ul
        className="flex flex-col gap-2"
        role="radiogroup"
        aria-labelledby={headingId}
        aria-required="true"
      >
        {OPTIONS.map((opt) => (
          <li key={opt.value}>
            <button
              type="button"
              role="radio"
              aria-checked={likert === opt.value}
              onClick={() => setLikert(opt.value)}
              className={cn(
                "flex min-h-11 w-full items-center rounded-lg border px-4 py-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-h-12",
                likert === opt.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:border-foreground/40"
              )}
            >
              {opt.label}
            </button>
          </li>
        ))}
      </ul>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3 text-sm">
        <input
          type="checkbox"
          checked={importante}
          onChange={(e) => setImportante(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">Dar mais peso a este tema</span> na comparação
          (votações, posições e projetos ligados a ele pesam o dobro).
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <button
          type="button"
          onClick={() => onBack?.(likert, importante)}
          disabled={!onBack}
          aria-disabled={!onBack}
          className={cn(
            "min-h-11 rounded-lg border border-border px-5 py-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-h-12",
            onBack
              ? "text-foreground hover:border-foreground/40"
              : "cursor-not-allowed text-muted-foreground"
          )}
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={likert == null}
          aria-disabled={likert == null}
          onClick={() => {
            if (likert == null) return
            onSubmit(likert, importante)
          }}
          className={cn(
            "min-h-11 w-full rounded-lg py-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-h-12",
            likert == null
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-foreground text-background hover:opacity-90"
          )}
        >
          Continuar
        </button>
      </div>
    </div>
  )
}
