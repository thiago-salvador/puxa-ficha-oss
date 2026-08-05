import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { processosOverviewDisplay } from "../src/lib/processos-display"
import { getProcessosEmptyState } from "../src/components/EmptyState"

describe("processosOverviewDisplay", () => {
  it("zero nunca vira '0': é ausência de verificação, não contagem", () => {
    assert.deepEqual(processosOverviewDisplay(0), { value: "—", sub: "não verificado" })
    assert.deepEqual(processosOverviewDisplay(null), { value: "—", sub: "não verificado" })
    assert.deepEqual(processosOverviewDisplay(undefined), { value: "—", sub: "não verificado" })
  })

  it("contagem positiva continua numérica, com destaque criminal", () => {
    assert.deepEqual(processosOverviewDisplay(3, 1), { value: 3, sub: "1 criminal" })
    assert.deepEqual(processosOverviewDisplay(2, 0), { value: 2, sub: undefined })
  })
})

describe("getProcessosEmptyState", () => {
  it("não afirma consulta que não houve, e nega a inferência de ficha limpa", () => {
    const estado = getProcessosEmptyState()
    const texto = `${estado.title} ${estado.description}`
    assert.ok(!texto.includes("bases consultadas"), "copy antiga afirmava consulta inexistente")
    assert.ok(!texto.toLowerCase().includes("nenhum processo encontrado"))
    assert.ok(texto.includes("não significa ficha limpa"))
    assert.ok(texto.includes("busca ativa"))
  })
})
