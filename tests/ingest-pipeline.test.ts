import assert from "node:assert/strict"
import { resolve } from "node:path"
import { describe, it } from "node:test"
import { normalizeForMatch } from "../scripts/lib/normalize-for-match"
import { parseCSV } from "../scripts/lib/parse-csv-local"
import {
  shouldSkipWeakMatchForAno,
  isWeakNameMatch,
  getResolveMethodPriority,
} from "../scripts/lib/tse-resolver"

// --- parseCSV with real TSE-format fixture ---

describe("parseCSV (TSE fixture)", () => {
  const fixturePath = resolve(process.cwd(), "tests/fixtures/tse-sample.csv")

  it("parses semicolon-delimited latin1 CSV with correct row count", async () => {
    let count = 0
    const total = await parseCSV(fixturePath, () => { count++ })
    assert.equal(total, 3)
    assert.equal(count, 3)
  })

  it("extracts named columns from TSE header", async () => {
    const rows: Record<string, string>[] = []
    await parseCSV(fixturePath, (row) => { rows.push(row) })

    assert.equal(rows[0].NM_URNA_CANDIDATO, "LULA")
    assert.equal(rows[0].NR_CPF_CANDIDATO, "12345678901")
    assert.equal(rows[0].SG_PARTIDO, "PT")
    assert.equal(rows[0].SG_UF, "SP")
    assert.equal(rows[0].DS_CARGO, "DEPUTADO FEDERAL")
    assert.equal(rows[0].DS_SIT_TOT_TURNO, "ELEITO")
  })

  it("trims whitespace from values", async () => {
    const rows: Record<string, string>[] = []
    await parseCSV(fixturePath, (row) => { rows.push(row) })
    // All values should be trimmed (csv-parse cast option)
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        assert.equal(value, value.trim(), `${key} should be trimmed`)
      }
    }
  })

  it("handles TSE junk values (NAO DIVULGAVEL, #NULO#)", async () => {
    const rows: Record<string, string>[] = []
    await parseCSV(fixturePath, (row) => { rows.push(row) })

    // Row 1 (Claudio Castro) has NAO DIVULGAVEL as CPF marker
    assert.equal(rows[1].NR_CPF_CANDIDATO, "NAO DIVULGAVEL")
    // Row 2 (Maria Silva) has #NULO# as CPF marker (NR_CPF_CANDIDATO)
    assert.equal(rows[2].NR_CPF_CANDIDATO, "#NULO#")
  })

  it("distinguishes candidatura status (DEFERIDO vs INDEFERIDO)", async () => {
    const rows: Record<string, string>[] = []
    await parseCSV(fixturePath, (row) => { rows.push(row) })

    assert.equal(rows[0].DS_SITUACAO_CANDIDATURA, "DEFERIDO")
    assert.equal(rows[2].DS_SITUACAO_CANDIDATURA, "INDEFERIDO")
  })
})

// --- normalizeForMatch ---

describe("normalizeForMatch", () => {
  it("strips diacritics and uppercases", () => {
    assert.equal(normalizeForMatch("João da Silva"), "JOAO DA SILVA")
  })

  it("normalizes cedilla", () => {
    assert.equal(normalizeForMatch("Gonçalves"), "GONCALVES")
  })

  it("trims whitespace", () => {
    assert.equal(normalizeForMatch("  LULA  "), "LULA")
  })
})

// --- tse-resolver pure functions ---

describe("tse-resolver", () => {
  it("getResolveMethodPriority: sq-preloaded > cpf > name-unique > name-uf", () => {
    assert.ok(getResolveMethodPriority("sq-preloaded") > getResolveMethodPriority("cpf"))
    assert.ok(getResolveMethodPriority("cpf") > getResolveMethodPriority("name-unique"))
    assert.ok(getResolveMethodPriority("name-unique") > getResolveMethodPriority("name-uf"))
  })

  it("isWeakNameMatch flags name-only matches", () => {
    assert.equal(isWeakNameMatch("name-unique"), true)
    assert.equal(isWeakNameMatch("name-uf"), true)
    assert.equal(isWeakNameMatch("cpf"), false)
    assert.equal(isWeakNameMatch("sq-preloaded"), false)
  })

  it("shouldSkipWeakMatchForAno: skips weak matches for 2024 municipal", () => {
    assert.equal(shouldSkipWeakMatchForAno(2024, "name-unique"), true)
    assert.equal(shouldSkipWeakMatchForAno(2024, "name-uf"), true)
    assert.equal(shouldSkipWeakMatchForAno(2024, "cpf"), false)
    assert.equal(shouldSkipWeakMatchForAno(2022, "name-unique"), false)
  })
})
