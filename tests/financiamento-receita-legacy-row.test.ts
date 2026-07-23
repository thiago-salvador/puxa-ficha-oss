import test from "node:test"
import assert from "node:assert/strict"
import { normalizeFinanciamentoReceitaRow } from "../scripts/lib/financiamento-receita-legacy-row"

test("normalizeFinanciamentoReceitaRow: mapeia cabeçalhos PT 2012 para chaves do ingest", () => {
  const raw = {
    "Sequencial Candidato": "40001234",
    "Numero Recibo Eleitoral": "999",
    "Valor receita": "1.234,56",
    "Tipo receita": "PF",
    "Nome do doador": "Maria",
    "CPF/CNPJ do doador": "12345678000199",
  }
  const row = normalizeFinanciamentoReceitaRow(raw)
  assert.equal(row.SQ_CANDIDATO, "40001234")
  assert.equal(row.SQ_RECEITA, "999")
  assert.equal(row.VR_RECEITA, "1.234,56")
  assert.ok(String(row.DS_ORIGEM_RECEITA).includes("PF"))
  assert.equal(row.NM_DOADOR, "Maria")
  assert.equal(row["CPF/CNPJ do doador"], "12345678000199")
})

test("normalizeFinanciamentoReceitaRow: preserva layout 2018+ quando já vem SQ_*", () => {
  const raw = {
    SQ_CANDIDATO: "1",
    SQ_RECEITA: "2",
    VR_RECEITA: "10,00",
    DS_ORIGEM_RECEITA: "PESSOA FISICA",
    NM_DOADOR_RFB: "João",
  }
  const row = normalizeFinanciamentoReceitaRow(raw)
  assert.equal(row.SQ_CANDIDATO, "1")
  assert.equal(row.SQ_RECEITA, "2")
  assert.equal(row.VR_RECEITA, "10,00")
  assert.equal(row.DS_ORIGEM_RECEITA, "PESSOA FISICA")
  assert.equal(row.NM_DOADOR_RFB, "João")
})
