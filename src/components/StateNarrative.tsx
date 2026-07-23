export function StateNarrative({ sentences }: { sentences: string[] }) {
  if (sentences.length === 0) return null

  return (
    <article
      className="rounded-[16px] border border-border/50 bg-muted/30 px-5 py-5 sm:px-6 sm:py-6"
      aria-labelledby="state-narrative-title"
    >
      <h2
        id="state-narrative-title"
        className="text-[length:var(--text-eyebrow)] font-bold uppercase tracking-[0.12em] text-muted-foreground"
      >
        Contexto
      </h2>
      <div className="mt-3 space-y-2 text-[length:var(--text-body)] font-medium leading-relaxed text-foreground sm:text-[15px]">
        {sentences.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </article>
  )
}
