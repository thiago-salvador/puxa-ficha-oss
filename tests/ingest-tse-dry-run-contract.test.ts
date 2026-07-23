import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync("scripts/lib/ingest-tse.ts", "utf8")

test("TSE ingest dry-run emits normalized rows without database mutations", () => {
  assert.match(source, /dryRun\?: boolean/)
  assert.match(source, /onPlannedRow\?: \(entry: PlannedTseRow\)/)
  assert.match(source, /if \(options\.dryRun\) \{[\s\S]*table: "patrimonio"/)
  assert.match(source, /if \(options\.dryRun\) \{[\s\S]*table: "financiamento"/)
  assert.match(source, /sanitizeMaioresDoadoresForPublic\(row\.maiores_doadores\)/)
  assert.match(source, /maskDocumentLikeSequences\(bem\.descricao\)/)
})

test("TSE ingest CLI exposes an explicit dry-run flag", () => {
  assert.match(source, /arg === "--dry-run"/)
  assert.match(source, /PF_TSE_INGEST_DRY_RUN/)
  assert.match(source, /options\.dryRun \? \{ dryRun: true, results, plannedRows \} : results/)
})
