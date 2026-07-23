/**
 * Backfill periodo_fim for historico_politico mandatos.
 *
 * Usage: npx tsx scripts/backfill-historico-periodo-fim.ts [--apply]
 * Default: dry-run. With --apply: writes to DB.
 * Generates data/manual-review-periodo-fim.csv for manual queue.
 */
import { pathToFileURL } from "node:url"
import { writeFileSync } from "fs"
import { resolve } from "path"
import { supabase } from "./lib/supabase"
import { log, warn } from "./lib/logger"

const ELECTIVE_CARGOS = new Set([
  "Presidente", "Vice-Presidente", "Governador", "Vice-Governador",
  "Senador", "Deputado Federal", "Deputado Estadual", "Deputado Distrital",
  "Prefeito", "Vice-Prefeito", "Vereador",
])

const INCOMPATIBILITY: Record<string, string[]> = {
  Presidente: ["Vice-Presidente", "Governador", "Vice-Governador", "Senador", "Deputado Federal", "Deputado Estadual", "Deputado Distrital", "Prefeito", "Vice-Prefeito", "Vereador"],
  "Vice-Presidente": ["Governador", "Vice-Governador", "Senador", "Deputado Federal", "Deputado Estadual", "Deputado Distrital", "Prefeito", "Vice-Prefeito", "Vereador"],
  Governador: ["Deputado Federal", "Deputado Estadual", "Deputado Distrital", "Vereador", "Prefeito", "Vice-Prefeito"],
  "Vice-Governador": ["Deputado Federal", "Deputado Estadual", "Deputado Distrital", "Vereador", "Prefeito", "Vice-Prefeito"],
  Senador: ["Deputado Federal", "Deputado Estadual", "Deputado Distrital", "Vereador"],
  Prefeito: ["Deputado Estadual", "Deputado Distrital", "Vereador"],
  "Deputado Federal": ["Deputado Estadual", "Deputado Distrital", "Vereador"],
  "Deputado Estadual": ["Vereador"],
  "Deputado Distrital": ["Vereador"],
}

const MAX_DURATION: Record<string, number> = {
  Presidente: 4, "Vice-Presidente": 4,
  Governador: 4, "Vice-Governador": 4,
  Prefeito: 4, "Vice-Prefeito": 4,
  Senador: 8,
  "Deputado Federal": 4, "Deputado Estadual": 4, "Deputado Distrital": 4,
  Vereador: 4,
}

export interface HistoricoRow {
  id: string
  candidato_id: string
  slug: string
  cargo_canonico: string
  periodo_inicio: number
  periodo_fim: number | null
  observacoes: string | null
}

export interface BackfillChange {
  id: string
  slug: string
  cargo: string
  inicio: number
  newFim: number
  reason: string
}

export interface BackfillResult {
  totalRows: number
  openRows: number
  autoQueueSize: number
  manualQueueSize: number
  changes: BackfillChange[]
  applied: number
  errors: number
  manualCsvRows: string[]
}

export interface BackfillDeps {
  apply: boolean
  fetchRows: () => Promise<HistoricoRow[]>
  updateRow: (id: string, periodoFim: number) => Promise<void>
  writeCSV?: (path: string, content: string) => void
  log: (message: string) => void
  warn: (message: string) => void
}

export function isAutoSource(obs: string | null): boolean {
  if (!obs) return false
  return obs.includes("(TSE ") || obs.includes("Wikidata")
}

export function closesMandate(newCargo: string, existingCargo: string): boolean {
  if (newCargo === existingCargo) return true
  return INCOMPATIBILITY[newCargo]?.includes(existingCargo) ?? false
}

export async function runBackfillHistoricoPeriodoFim(deps: BackfillDeps): Promise<BackfillResult> {
  const { apply, fetchRows, updateRow, log: logFn, warn: warnFn } = deps

  logFn(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`)

  const rows = await fetchRows()
  const openRows = rows.filter((r) => r.periodo_fim === null)
  const autoQueue = openRows.filter((r) => isAutoSource(r.observacoes))
  const manualQueue = openRows.filter((r) => !isAutoSource(r.observacoes))

  logFn(`Total rows: ${rows.length}, open: ${openRows.length}`)
  logFn(`AUTO queue (TSE+Wikidata): ${autoQueue.length}`)
  logFn(`MANUAL queue (to CSV): ${manualQueue.length}`)

  const csvHeader = "id,slug,cargo_canonico,periodo_inicio,periodo_fim,observacoes"
  const csvDataRows = manualQueue.map((r) =>
    `${r.id},${r.slug},${r.cargo_canonico},${r.periodo_inicio},${r.periodo_fim ?? ""},${(r.observacoes ?? "").replace(/,/g, ";")}`
  )
  const manualCsvRows = [csvHeader, ...csvDataRows]

  if (deps.writeCSV) {
    deps.writeCSV("manual-review-periodo-fim.csv", manualCsvRows.join("\n"))
  }

  const byCandidato = new Map<string, HistoricoRow[]>()
  for (const row of rows) {
    const candidateRows = byCandidato.get(row.candidato_id) ?? []
    candidateRows.push(row)
    byCandidato.set(row.candidato_id, candidateRows)
  }

  const changes: BackfillChange[] = []
  const autoIds = new Set(autoQueue.map((r) => r.id))

  for (const candidateRows of byCandidato.values()) {
    const autoRecords = candidateRows.filter((r) => autoIds.has(r.id))
    if (autoRecords.length === 0) continue

    const sorted = [...candidateRows].sort((a, b) => a.periodo_inicio - b.periodo_inicio)

    for (const record of autoRecords) {
      if (record.periodo_fim !== null) continue

      const laterSame = sorted.find((r) =>
        r.cargo_canonico === record.cargo_canonico &&
        r.periodo_inicio > record.periodo_inicio &&
        r.id !== record.id
      )
      if (laterSame) {
        changes.push({
          id: record.id,
          slug: record.slug,
          cargo: record.cargo_canonico,
          inicio: record.periodo_inicio,
          newFim: laterSame.periodo_inicio,
          reason: `closed by later ${record.cargo_canonico} (${laterSame.periodo_inicio})`,
        })
        continue
      }

      if (ELECTIVE_CARGOS.has(record.cargo_canonico)) {
        const laterCloser = sorted.find((r) =>
          r.periodo_inicio > record.periodo_inicio &&
          r.id !== record.id &&
          ELECTIVE_CARGOS.has(r.cargo_canonico) &&
          closesMandate(r.cargo_canonico, record.cargo_canonico)
        )
        if (laterCloser) {
          changes.push({
            id: record.id,
            slug: record.slug,
            cargo: record.cargo_canonico,
            inicio: record.periodo_inicio,
            newFim: laterCloser.periodo_inicio,
            reason: `closed by ${laterCloser.cargo_canonico} (${laterCloser.periodo_inicio})`,
          })
          continue
        }
      }

      const maxDur = MAX_DURATION[record.cargo_canonico]
      if (maxDur && record.periodo_inicio < 2022 && (2026 - record.periodo_inicio) > maxDur) {
        changes.push({
          id: record.id,
          slug: record.slug,
          cargo: record.cargo_canonico,
          inicio: record.periodo_inicio,
          newFim: record.periodo_inicio + maxDur,
          reason: `max duration ${maxDur}yr (${record.cargo_canonico}, started ${record.periodo_inicio})`,
        })
      }
    }
  }

  logFn(`Changes proposed: ${changes.length}`)
  for (const change of changes) {
    logFn(`  ${change.slug}: ${change.cargo} ${change.inicio} -> fim=${change.newFim} (${change.reason})`)
  }

  let applied = 0
  let errors = 0
  if (apply && changes.length > 0) {
    for (const change of changes) {
      try {
        await updateRow(change.id, change.newFim)
        applied++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        warnFn(`Failed ${change.slug} ${change.cargo} ${change.inicio}: ${message}`)
        errors++
      }
    }
    logFn(`Applied: ${applied}, errors: ${errors}`)
  } else if (!apply) {
    logFn("Dry-run complete. Use --apply to execute.")
  }

  return {
    totalRows: rows.length,
    openRows: openRows.length,
    autoQueueSize: autoQueue.length,
    manualQueueSize: manualQueue.length,
    changes,
    applied,
    errors,
    manualCsvRows,
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SupabaseLikeClient {
  from(table: string): any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function createBackfillDepsFromClient(
  client: SupabaseLikeClient,
  options: { apply: boolean; logFn?: (msg: string) => void; warnFn?: (msg: string) => void }
): BackfillDeps {
  return {
    apply: options.apply,
    async fetchRows() {
      const { data: allRows, error: queryErr } = await client
        .from("historico_politico")
        .select("id, candidato_id, cargo_canonico, periodo_inicio, periodo_fim, observacoes, candidatos!inner(slug)")
        .eq("tipo_evento", "mandato")
        .not("periodo_inicio", "is", null)
        .order("periodo_inicio", { ascending: true })

      if (queryErr || !allRows) {
        throw new Error(`Query failed: ${queryErr?.message}`)
      }

      return allRows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        candidato_id: row.candidato_id as string,
        slug: ((row.candidatos as Record<string, unknown>)?.slug ?? "unknown") as string,
        cargo_canonico: row.cargo_canonico as string,
        periodo_inicio: row.periodo_inicio as number,
        periodo_fim: row.periodo_fim as number | null,
        observacoes: row.observacoes as string | null,
      }))
    },
    async updateRow(id, periodoFim) {
      const { error: updateErr } = await client
        .from("historico_politico")
        .update({ periodo_fim: periodoFim })
        .eq("id", id)

      if (updateErr) throw new Error(updateErr.message)
    },
    log: options.logFn ?? (() => {}),
    warn: options.warnFn ?? (() => {}),
  }
}

const SRC = "backfill-periodo-fim"

async function main() {
  const apply = process.argv.includes("--apply")
  const deps = createBackfillDepsFromClient(supabase, {
    apply,
    logFn: (msg) => log(SRC, msg),
    warnFn: (msg) => warn(SRC, msg),
  })
  deps.writeCSV = (filename, content) => {
    const csvPath =
      process.env.PF_MANUAL_REVIEW_PERIODO_FIM_CSV_PATH?.trim() || resolve(process.cwd(), `data/${filename}`)
    writeFileSync(csvPath, content, "utf-8")
    log(SRC, `Manual review CSV: ${csvPath}`)
  }
  await runBackfillHistoricoPeriodoFim(deps)
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isDirectRun) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
