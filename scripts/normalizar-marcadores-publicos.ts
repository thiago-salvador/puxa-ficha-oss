import { supabase } from "./lib/supabase"

const PAGE_SIZE = 500
const MARKER_RE = /#(?:NULO|NE)#?/gi
const ONLY_MARKER_RE = /^\s*#(?:NULO|NE)#?\s*$/i
const APPLY = process.argv.includes("--apply")

type PatrimonioRow = {
  id: string
  bens: unknown
}

type HistoricoRow = {
  id: string
  observacoes: string | null
}

async function readPublicCandidateIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("candidatos_publico")
    .select("id")
    .neq("status", "removido")

  if (error) throw new Error(`candidatos_publico read failed: ${error.message}`)
  return (data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

function normalizeMarkerText(value: string): string {
  return value.replace(MARKER_RE, "").replace(/\s{2,}/g, " ").trim()
}

function normalizePatrimonioBens(value: unknown): unknown {
  if (!Array.isArray(value)) return value

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item

    const bem = item as Record<string, unknown>
    if (typeof bem.descricao !== "string" || !MARKER_RE.test(bem.descricao)) {
      MARKER_RE.lastIndex = 0
      return item
    }

    MARKER_RE.lastIndex = 0
    return { ...bem, descricao: normalizeMarkerText(bem.descricao) }
  })
}

function patrimonioHasMarker(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const descricao = (item as Record<string, unknown>).descricao
    if (typeof descricao !== "string") return false
    const found = MARKER_RE.test(descricao)
    MARKER_RE.lastIndex = 0
    return found
  })
}

async function readPatrimonio(candidateIds: string[]): Promise<PatrimonioRow[]> {
  const rows: PatrimonioRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("patrimonio")
      .select("id,bens")
      .in("candidato_id", candidateIds)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`patrimonio read failed: ${error.message}`)
    rows.push(...((data ?? []) as PatrimonioRow[]))
    if ((data ?? []).length < PAGE_SIZE) return rows
  }
}

async function readHistorico(candidateIds: string[]): Promise<HistoricoRow[]> {
  const rows: HistoricoRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("historico_politico")
      .select("id,observacoes")
      .in("candidato_id", candidateIds)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`historico_politico read failed: ${error.message}`)
    rows.push(...((data ?? []) as HistoricoRow[]))
    if ((data ?? []).length < PAGE_SIZE) return rows
  }
}

async function updateRows(
  table: "patrimonio" | "historico_politico",
  rows: Array<{ id: string; value: unknown }>
): Promise<void> {
  for (const row of rows) {
    const payload = table === "patrimonio" ? { bens: row.value } : { observacoes: row.value }
    const { error } = await supabase.from(table).update(payload).eq("id", row.id)
    if (error) throw new Error(`${table} update failed: ${error.message}`)
  }
}

async function main(): Promise<void> {
  const candidateIds = await readPublicCandidateIds()
  const [patrimonio, historico] = await Promise.all([
    readPatrimonio(candidateIds),
    readHistorico(candidateIds),
  ])

  const patrimonioUpdates = patrimonio
    .map((row) => ({ id: row.id, value: normalizePatrimonioBens(row.bens), before: row.bens }))
    .filter((row) => patrimonioHasMarker(row.before))
    .map(({ id, value }) => ({ id, value }))

  const historicoUpdates = historico
    .filter((row) => typeof row.observacoes === "string" && MARKER_RE.test(row.observacoes))
    .map((row) => {
      MARKER_RE.lastIndex = 0
      return { id: row.id, value: normalizeMarkerText(row.observacoes ?? "") }
    })

  const exactPatrimonioMarkers = patrimonio.reduce((count, row) => {
    if (!Array.isArray(row.bens)) return count
    return count + row.bens.filter(
      (bem) =>
        bem &&
        typeof bem === "object" &&
        typeof (bem as Record<string, unknown>).descricao === "string" &&
        ONLY_MARKER_RE.test((bem as Record<string, unknown>).descricao as string)
    ).length
  }, 0)

  console.log(`mode=${APPLY ? "apply" : "dry-run"}`)
  console.log(`candidatos_publico: ids=${candidateIds.length}`)
  console.log(`patrimonio: rows=${patrimonio.length} affected=${patrimonioUpdates.length} exact_markers=${exactPatrimonioMarkers}`)
  console.log(`historico_politico: rows=${historico.length} affected=${historicoUpdates.length}`)

  if (!APPLY) {
    console.log("dry-run: no remote writes performed")
    return
  }

  await updateRows("patrimonio", patrimonioUpdates)
  await updateRows("historico_politico", historicoUpdates)

  const [patrimonioReadback, historicoReadback] = await Promise.all([readPatrimonio(), readHistorico()])
  const remainingPatrimonio = patrimonioReadback.filter((row) => patrimonioHasMarker(row.bens)).length
  const remainingHistorico = historicoReadback.filter((row) => typeof row.observacoes === "string" && MARKER_RE.test(row.observacoes)).length
  MARKER_RE.lastIndex = 0

  if (remainingPatrimonio > 0 || remainingHistorico > 0) {
    throw new Error(
      `readback failed: patrimonio=${remainingPatrimonio}, historico_politico=${remainingHistorico}`
    )
  }

  console.log("readback: no #NULO#/#NE# markers remain in the targeted public fields")
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
