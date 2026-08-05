import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const renato = readFileSync(
  "supabase/migrations/20260805134000_renato_gomes_homonimo_remocao.sql",
  "utf8",
)
const sweep = readFileSync(
  "supabase/migrations/20260805135000_varredura_homonimos_cadu_juliana.sql",
  "utf8",
)
const prefixNormalization = readFileSync(
  "supabase/migrations/20260805133000_cargo_canonico_sem_prefixo_de_candidatura.sql",
  "utf8",
)
const renatoFormation = readFileSync(
  "supabase/migrations/20260805136000_renato_gomes_formacao_homonimo.sql",
  "utf8",
)
const renatoAuditCorrection = readFileSync(
  "supabase/migrations/20260805137000_renato_gomes_corrige_log_identidade.sql",
  "utf8",
)

describe("correções de identidade por homônimo", () => {
  it("remove as cinco linhas filhas e zera os campos civis de renato-gomes", () => {
    assert.match(renato, /DELETE FROM public\.patrimonio/)
    assert.match(renato, /DELETE FROM public\.financiamento/)
    assert.match(renato, /DELETE FROM public\.historico_politico/)
    assert.match(renato, /nome_completo = nome_urna/)
    assert.match(renato, /naturalidade = NULL/)
    assert.match(renato, /profissao_declarada = NULL/)
    assert.match(renato, /ainda existe linha filha ligada a ficha/)
  })

  it("limpa a identidade e o dinheiro do homônimo de cadu-xavier", () => {
    assert.match(sweep, /slug = 'cadu-xavier'/)
    assert.match(sweep, /SQ 200000998862/)
    assert.match(sweep, /cpf = NULL/)
    assert.match(sweep, /data_nascimento = NULL/)
    assert.match(sweep, /profissao_declarada = NULL/)
    assert.match(sweep, /Vazios confirmados anteriores invalidos/)
  })

  it("despublica só a vereadora homônima e preserva a prefeita Juliana Brizola", () => {
    assert.match(sweep, /SQ 210001233500/)
    assert.match(sweep, /SQ 210001189949/)
    assert.match(sweep, /cargo_canonico = 'Vereador'/)
    assert.match(sweep, /cargo_canonico = 'Prefeito'/)
    assert.match(sweep, /juliana_homonima: estado pos-correcao inesperado/)
  })

  it("não grava documentos pessoais literais nas migrations", () => {
    assert.doesNotMatch(`${renato}\n${sweep}`, /\b\d{11}\b/)
  })

  it("a conferência de duplicatas não conta homônimos despublicados antes", () => {
    assert.match(
      prefixNormalization,
      /despublicacao_motivo LIKE 'Duplicata da mesma candidatura%'/,
    )
  })

  it("restringe as duplicatas de cargo aos dois casos confirmados", () => {
    assert.match(prefixNormalization, /c\.slug = 'henrique-areas'/)
    assert.match(prefixNormalization, /c\.slug = 'indira-xavier'/)
    assert.match(prefixNormalization, /gemea\.partido = h\.partido/)
    assert.match(prefixNormalization, /gemea\.tipo_evento = h\.tipo_evento/)
  })

  it("remove o resíduo de formação do mesmo SQ de Renato", () => {
    assert.match(renatoFormation, /formacao = 'Ensino médio completo'/)
    assert.match(renatoFormation, /SET formacao = NULL/)
    assert.match(renatoFormation, /nenhuma formacao foi inferida/)
  })

  it("corrige no banco o texto de auditoria de Renato", () => {
    assert.match(renato, /Nome completo voltou ao nome_urna/)
    assert.match(renatoAuditCorrection, /Nome completo voltou ao nome_urna/)
    assert.match(renatoAuditCorrection, /GET DIAGNOSTICS linhas = ROW_COUNT/)
  })
})
