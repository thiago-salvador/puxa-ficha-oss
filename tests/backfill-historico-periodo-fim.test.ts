import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  runBackfillHistoricoPeriodoFim,
  createBackfillDepsFromClient,
  isAutoSource,
  closesMandate,
  type HistoricoRow,
} from "../scripts/backfill-historico-periodo-fim"
import { HistoricoChainFixture } from "./helpers/historico-chain-fixture"

// --- Helper factory ---

let idCounter = 0
function row(
  overrides: Partial<HistoricoRow> & Pick<HistoricoRow, "candidato_id" | "cargo_canonico" | "periodo_inicio">
): HistoricoRow {
  idCounter++
  return {
    id: `hp-${idCounter}`,
    slug: overrides.slug ?? `slug-${overrides.candidato_id}`,
    periodo_fim: null,
    observacoes: "(TSE 2022)",
    ...overrides,
  }
}

function noop() {}

// --- Unit: isAutoSource ---

describe("isAutoSource", () => {
  it("recognizes TSE source", () => {
    assert.equal(isAutoSource("(TSE 2022) eleito"), true)
  })
  it("recognizes Wikidata source", () => {
    assert.equal(isAutoSource("Wikidata mandato"), true)
  })
  it("rejects null/empty/manual", () => {
    assert.equal(isAutoSource(null), false)
    assert.equal(isAutoSource(""), false)
    assert.equal(isAutoSource("curadoria editorial"), false)
  })
})

// --- Unit: closesMandate ---

describe("closesMandate", () => {
  it("same cargo closes itself", () => {
    assert.equal(closesMandate("Senador", "Senador"), true)
  })
  it("Presidente closes Deputado Federal", () => {
    assert.equal(closesMandate("Presidente", "Deputado Federal"), true)
  })
  it("Vereador does not close Deputado Federal", () => {
    assert.equal(closesMandate("Vereador", "Deputado Federal"), false)
  })
  it("Governador closes Prefeito", () => {
    assert.equal(closesMandate("Governador", "Prefeito"), true)
  })
})

// --- Integration: runBackfillHistoricoPeriodoFim ---

describe("backfill-historico-periodo-fim", () => {
  it("Rule A: later same cargo closes earlier (dry-run)", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2014 }),
      row({ candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2022 }),
    ]

    const result = await runBackfillHistoricoPeriodoFim({
      apply: false,
      fetchRows: async () => rows,
      updateRow: async () => { throw new Error("should not write in dry-run") },
      log: noop,
      warn: noop,
    })

    assert.equal(result.changes.length, 1)
    assert.equal(result.changes[0].id, "hp-1")
    assert.equal(result.changes[0].newFim, 2022)
    assert.match(result.changes[0].reason, /closed by later Deputado Federal/)
    assert.equal(result.applied, 0)
  })

  it("Rule B: incompatibility closes lower cargo", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Vereador", periodo_inicio: 2016 }),
      row({ candidato_id: "c1", cargo_canonico: "Deputado Estadual", periodo_inicio: 2022 }),
    ]

    const result = await runBackfillHistoricoPeriodoFim({
      apply: false,
      fetchRows: async () => rows,
      updateRow: async () => {},
      log: noop,
      warn: noop,
    })

    assert.equal(result.changes.length, 1)
    assert.equal(result.changes[0].id, "hp-1")
    assert.equal(result.changes[0].newFim, 2022)
    assert.match(result.changes[0].reason, /closed by Deputado Estadual/)
  })

  it("Rule C: max duration fallback for old mandatos", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2010 }),
    ]

    const result = await runBackfillHistoricoPeriodoFim({
      apply: false,
      fetchRows: async () => rows,
      updateRow: async () => {},
      log: noop,
      warn: noop,
    })

    assert.equal(result.changes.length, 1)
    assert.equal(result.changes[0].newFim, 2014) // 2010 + 4
    assert.match(result.changes[0].reason, /max duration 4yr/)
  })

  it("Rule C: Senador gets 8yr max duration", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Senador", periodo_inicio: 2010 }),
    ]

    const result = await runBackfillHistoricoPeriodoFim({
      apply: false,
      fetchRows: async () => rows,
      updateRow: async () => {},
      log: noop,
      warn: noop,
    })

    assert.equal(result.changes.length, 1)
    assert.equal(result.changes[0].newFim, 2018)
    assert.match(result.changes[0].reason, /max duration 8yr/)
  })

  it("manual source rows go to CSV queue, not auto processing", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Vereador", periodo_inicio: 2008, observacoes: "curadoria editorial" }),
    ]

    const result = await runBackfillHistoricoPeriodoFim({
      apply: false,
      fetchRows: async () => rows,
      updateRow: async () => {},
      log: noop,
      warn: noop,
    })

    assert.equal(result.autoQueueSize, 0)
    assert.equal(result.manualQueueSize, 1)
    assert.equal(result.changes.length, 0, "manual rows should not generate auto changes")
    assert.ok(result.manualCsvRows.length > 1, "CSV should have header + data")
    assert.match(result.manualCsvRows[1], /curadoria editorial/)
  })

  it("already closed rows are skipped", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2014, periodo_fim: 2018 }),
    ]

    const result = await runBackfillHistoricoPeriodoFim({
      apply: false,
      fetchRows: async () => rows,
      updateRow: async () => {},
      log: noop,
      warn: noop,
    })

    assert.equal(result.openRows, 0)
    assert.equal(result.changes.length, 0)
  })

  it("apply mode writes and counts correctly", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2014 }),
      row({ candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2022 }),
    ]
    const updates: Array<{ id: string; periodoFim: number }> = []

    const result = await runBackfillHistoricoPeriodoFim({
      apply: true,
      fetchRows: async () => rows,
      updateRow: async (id, periodoFim) => { updates.push({ id, periodoFim }) },
      log: noop,
      warn: noop,
    })

    assert.equal(result.applied, 1)
    assert.equal(result.errors, 0)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].id, "hp-1")
    assert.equal(updates[0].periodoFim, 2022)
  })

  it("apply mode counts errors from updateRow failures", async () => {
    idCounter = 0
    const rows: HistoricoRow[] = [
      row({ candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2010 }),
    ]

    const result = await runBackfillHistoricoPeriodoFim({
      apply: true,
      fetchRows: async () => rows,
      updateRow: async () => { throw new Error("DB write failed") },
      log: noop,
      warn: noop,
    })

    assert.equal(result.applied, 0)
    assert.equal(result.errors, 1)
  })
})

// --- Chain-level: exercises the real SELECT/UPDATE Supabase chain via createBackfillDepsFromClient ---

describe("backfill-historico-periodo-fim (chain-level DB I/O)", () => {
  it("SELECT chain filters tipo_evento=mandato, excludes null periodo_inicio, orders by periodo_inicio", async () => {
    const fixture = new HistoricoChainFixture([
      {
        id: "hp-100",
        candidato_id: "c1",
        cargo_canonico: "Deputado Federal",
        periodo_inicio: 2018,
        periodo_fim: null,
        observacoes: "(TSE 2018)",
        tipo_evento: "mandato",
        candidatos: { slug: "fulano" },
      },
      {
        id: "hp-101",
        candidato_id: "c1",
        cargo_canonico: "Deputado Federal",
        periodo_inicio: 2022,
        periodo_fim: null,
        observacoes: "(TSE 2022)",
        tipo_evento: "mandato",
        candidatos: { slug: "fulano" },
      },
      // Should be filtered out: tipo_evento != mandato
      {
        id: "hp-102",
        candidato_id: "c1",
        cargo_canonico: "Deputado Federal",
        periodo_inicio: 2014,
        periodo_fim: null,
        observacoes: "(TSE 2014)",
        tipo_evento: "candidatura",
        candidatos: { slug: "fulano" },
      },
      // Should be filtered out: periodo_inicio is null
      {
        id: "hp-103",
        candidato_id: "c2",
        cargo_canonico: "Senador",
        periodo_inicio: null as unknown as number,
        periodo_fim: null,
        observacoes: "Wikidata",
        tipo_evento: "mandato",
        candidatos: { slug: "ciclano" },
      },
    ])

    const deps = createBackfillDepsFromClient(fixture.createClient(), { apply: false })
    const result = await runBackfillHistoricoPeriodoFim(deps)

    // Only 2 mandato rows with non-null periodo_inicio should be fetched
    assert.equal(result.totalRows, 2)
    // hp-100 (2018) closed by hp-101 (2022) via Rule A
    assert.equal(result.changes.length, 1)
    assert.equal(result.changes[0].id, "hp-100")
    assert.equal(result.changes[0].newFim, 2022)

    // Verify the SELECT chain was built correctly
    assert.ok(fixture.queryLog.includes("from(historico_politico)"))
    assert.ok(fixture.queryLog.some((l) => l.includes("eq(tipo_evento,mandato)")))
    assert.ok(fixture.queryLog.some((l) => l.includes("not(periodo_inicio,is,null)")))
    assert.ok(fixture.queryLog.some((l) => l.includes("order(periodo_inicio,asc=true)")))
  })

  it("UPDATE chain writes periodo_fim via from().update().eq() in apply mode", async () => {
    const fixture = new HistoricoChainFixture([
      {
        id: "hp-200",
        candidato_id: "c1",
        cargo_canonico: "Vereador",
        periodo_inicio: 2016,
        periodo_fim: null,
        observacoes: "(TSE 2016)",
        tipo_evento: "mandato",
        candidatos: { slug: "beltrano" },
      },
      {
        id: "hp-201",
        candidato_id: "c1",
        cargo_canonico: "Deputado Estadual",
        periodo_inicio: 2022,
        periodo_fim: null,
        observacoes: "(TSE 2022)",
        tipo_evento: "mandato",
        candidatos: { slug: "beltrano" },
      },
    ])

    const deps = createBackfillDepsFromClient(fixture.createClient(), { apply: true })
    const result = await runBackfillHistoricoPeriodoFim(deps)

    // Rule B: Vereador closed by Deputado Estadual
    assert.equal(result.applied, 1)
    assert.equal(result.errors, 0)
    assert.equal(fixture.updates.length, 1)
    assert.equal(fixture.updates[0].id, "hp-200")
    assert.deepEqual(fixture.updates[0].payload, { periodo_fim: 2022 })

    // Verify the UPDATE chain was built correctly
    const updateLogs = fixture.queryLog.filter((l) => l.startsWith("update("))
    assert.equal(updateLogs.length, 1)
    assert.ok(updateLogs[0].includes('"periodo_fim":2022'))
  })

  it("candidatos!inner(slug) join shape: slug is extracted from nested candidatos object", async () => {
    const fixture = new HistoricoChainFixture([
      {
        id: "hp-300",
        candidato_id: "c1",
        cargo_canonico: "Senador",
        periodo_inicio: 2010,
        periodo_fim: null,
        observacoes: "(TSE 2010)",
        tipo_evento: "mandato",
        candidatos: { slug: "specific-slug" },
      },
    ])

    const deps = createBackfillDepsFromClient(fixture.createClient(), { apply: false })
    const result = await runBackfillHistoricoPeriodoFim(deps)

    // Slug is extracted from the candidatos join
    assert.equal(result.changes[0].slug, "specific-slug")
    // Verify column projection includes the join
    assert.ok(fixture.queryLog.some((l) => l.includes("candidatos!inner(slug)")))
  })

  it("full cycle: apply mutates fixture DB state and final row values match expected", async () => {
    // Scenario: 3 candidates with various rules
    // c1: Deputado Federal 2014 (open, auto) -> 2022 (open, auto) => Rule A closes 2014, 2022 stays open
    // c2: Vereador 2016 (open, auto) -> Governador 2022 (open, auto) => Rule B closes Vereador
    // c3: Senador 2010 (open, auto) => Rule C: max 8yr => fim=2018
    // c4: Deputado Federal 2008 (open, manual/curadoria) => NOT auto-processed (manual queue)
    const fixture = new HistoricoChainFixture([
      { id: "h1", candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2014, periodo_fim: null, observacoes: "(TSE 2014)", tipo_evento: "mandato", candidatos: { slug: "alice" } },
      { id: "h2", candidato_id: "c1", cargo_canonico: "Deputado Federal", periodo_inicio: 2022, periodo_fim: null, observacoes: "(TSE 2022)", tipo_evento: "mandato", candidatos: { slug: "alice" } },
      { id: "h3", candidato_id: "c2", cargo_canonico: "Vereador", periodo_inicio: 2016, periodo_fim: null, observacoes: "Wikidata mandato", tipo_evento: "mandato", candidatos: { slug: "bob" } },
      { id: "h4", candidato_id: "c2", cargo_canonico: "Governador", periodo_inicio: 2022, periodo_fim: null, observacoes: "(TSE 2022)", tipo_evento: "mandato", candidatos: { slug: "bob" } },
      { id: "h5", candidato_id: "c3", cargo_canonico: "Senador", periodo_inicio: 2010, periodo_fim: null, observacoes: "(TSE 2010)", tipo_evento: "mandato", candidatos: { slug: "carol" } },
      { id: "h6", candidato_id: "c4", cargo_canonico: "Deputado Federal", periodo_inicio: 2008, periodo_fim: null, observacoes: "curadoria editorial", tipo_evento: "mandato", candidatos: { slug: "dave" } },
    ])

    const deps = createBackfillDepsFromClient(fixture.createClient(), { apply: true })
    const result = await runBackfillHistoricoPeriodoFim(deps)

    // Verify business logic results
    assert.equal(result.changes.length, 3, "3 changes: Rule A + Rule B + Rule C")
    assert.equal(result.applied, 3)
    assert.equal(result.errors, 0)
    assert.equal(result.manualQueueSize, 1, "c4 is manual")

    // --- KEY ASSERTION: verify final DB state in the fixture ---
    const rows = fixture.getRows()
    const byId = new Map(rows.map((r) => [r.id, r]))

    // h1: Rule A closed by h2 (2014 -> fim=2022)
    assert.equal(byId.get("h1")!.periodo_fim, 2022, "h1 closed by later same cargo")

    // h2: stays open (no later same cargo, no incompatible, 2022 >= 2022 so no Rule C)
    assert.equal(byId.get("h2")!.periodo_fim, null, "h2 stays open")

    // h3: Rule B closed by Governador h4 (2016 -> fim=2022)
    assert.equal(byId.get("h3")!.periodo_fim, 2022, "h3 Vereador closed by Governador")

    // h4: stays open (Governador 2022, no incompatible closer, no Rule C for 2022+)
    assert.equal(byId.get("h4")!.periodo_fim, null, "h4 Governador stays open")

    // h5: Rule C max 8yr (2010 + 8 = 2018)
    assert.equal(byId.get("h5")!.periodo_fim, 2018, "h5 Senador max duration 8yr")

    // h6: manual source, NOT auto-processed, stays open
    assert.equal(byId.get("h6")!.periodo_fim, null, "h6 manual queue untouched")

    // Verify updates array tracks all DB writes
    assert.equal(fixture.updates.length, 3)
    const updateIds = new Set(fixture.updates.map((u) => u.id))
    assert.ok(updateIds.has("h1"))
    assert.ok(updateIds.has("h3"))
    assert.ok(updateIds.has("h5"))
    assert.ok(!updateIds.has("h6"), "manual row not updated")
  })
})
