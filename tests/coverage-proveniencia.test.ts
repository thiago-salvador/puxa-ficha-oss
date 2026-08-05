/**
 * Procedência do zero no relatório de cobertura (2026-08-04).
 *
 * O que estes testes protegem é uma distinção editorial, não um detalhe de
 * implementação: até 04/08 o relatório dizia "zero" para 954 células sem
 * conseguir separar "consultamos e não havia" de "nunca fomos olhar". Quem lê
 * "0 sanções" ao lado de um político com cinco mandatos precisa saber qual dos
 * dois é. Errar aqui é publicar silêncio como se fosse resposta.
 *
 * A regra sob teste é conservadora de propósito: só vira `vazio_confirmado`
 * quando TODAS as fontes daquela coluna responderam, e qualquer sinal de falha
 * ou de fonte não consultada rebaixa o veredito.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  FONTES_POR_COLUNA,
  calcularCelulas,
  provenienciaDoZero,
  type CandidatoCoverage,
  type ResultadoColeta,
} from "../scripts/audit/lib/coverage-model"
import { aplicarColetas } from "../scripts/audit/coverage-report"

/** Candidato mínimo: tudo vazio, que é o cenário em que a procedência importa. */
function candidato(over: Partial<CandidatoCoverage> = {}): CandidatoCoverage {
  return {
    slug: "fulano",
    nome_urna: "Fulano",
    partido_sigla: "XPTO",
    cargo_disputado: "Governador",
    estado: "SP",
    foto: false,
    bio: false,
    redes: false,
    idade: null,
    naturalidade: null,
    formacao: null,
    profissao: null,
    historico: [],
    temSqNoSeed: false,
    mudancas: 0,
    patrimonioAnos: [],
    patrimonioAnosComBens: [],
    financiamentoAnos: [],
    financiamentoAnosComDoadores: [],
    votos: 0,
    contradicoes: 0,
    processos: 0,
    alertas: 0,
    projetos: 0,
    destaquesVisiveis: 0,
    destaquesTotais: 0,
    gastosAnos: [],
    legislacaoExecutivo: 0,
    noticias: 0,
    posicoesTemasVerificados: [],
    posicoesTemasPendentes: [],
    sancoes: 0,
    itensRevisar: [],
    ...over,
  }
}

/** Todas as fontes de uma coluna com o mesmo desfecho. */
function todas(coluna: string, r: ResultadoColeta): Record<string, ResultadoColeta> {
  return Object.fromEntries(FONTES_POR_COLUNA[coluna].map((f) => [f, r]))
}

test("sem log de coleta lido, nenhum zero afirma nada", () => {
  assert.equal(provenienciaDoZero("sancoes", undefined), "desconhecida")
  // E o relatório precisa dizer isso na célula, não esconder.
  const cel = calcularCelulas(candidato()).sancoes
  assert.equal(cel.state, "zero")
  assert.equal(cel.proveniencia, "desconhecida")
})

test("candidato olhado mas sem nenhuma tentativa é 'nunca verificado', não 'vazio'", () => {
  // A diferença entre `undefined` (não lemos o log) e `{}` (lemos, e não há
  // tentativa) é o coração da feature: colapsar as duas repete o bug antigo.
  assert.equal(provenienciaDoZero("sancoes", {}), "nunca_verificado")
})

test("só vira 'verificado e vazio' quando toda fonte da coluna respondeu vazio", () => {
  assert.equal(provenienciaDoZero("sancoes", todas("sancoes", "vazio_confirmado")), "vazio_confirmado")

  // `cargos` depende de quatro fontes; três não bastam.
  const parcial = { ...todas("cargos", "vazio_confirmado") }
  delete parcial[FONTES_POR_COLUNA.cargos[0]]
  assert.equal(provenienciaDoZero("cargos", parcial), "nunca_verificado")
})

test("uma falha rebaixa o veredito mesmo com as outras fontes confirmadas", () => {
  const comErro = { ...todas("alertas", "vazio_confirmado"), tcu: "erro" as ResultadoColeta }
  assert.equal(provenienciaDoZero("alertas", comErro), "erro")

  const semVeredito = {
    ...todas("alertas", "vazio_confirmado"),
    tcu: "indeterminado" as ResultadoColeta,
  }
  assert.equal(provenienciaDoZero("alertas", semVeredito), "indeterminado")
})

test("'nao_aplicavel' não impede o zero de ser confirmado", () => {
  // A fonte declarou que a pergunta não cabe para este alvo. Isso é resposta,
  // não silêncio, então não pode rebaixar o veredito das outras.
  const misto = {
    ...todas("partidos", "vazio_confirmado"),
    filiacao: "nao_aplicavel" as ResultadoColeta,
  }
  assert.equal(provenienciaDoZero("partidos", misto), "vazio_confirmado")
})

test("'encontrado' com célula zerada é contradição, e vale como não verificado", () => {
  // A coleta disse que achou e a ficha está vazia: alguma das duas está errada,
  // e não dá para vender esse zero como confirmado.
  assert.equal(
    provenienciaDoZero("sancoes", todas("sancoes", "encontrado")),
    "nunca_verificado"
  )
})

test("coluna sem ingest é 'sem fonte', e não promete coleta que não existe", () => {
  // Processos judiciais não têm ingest: os registros que existem vieram de
  // curadoria manual. Marcar como 'nunca verificado' sugeriria uma coleta
  // pendente de rodar, e não há nenhuma.
  assert.deepEqual(FONTES_POR_COLUNA.processos, [])
  assert.equal(provenienciaDoZero("processos", {}), "sem_fonte")
  assert.equal(provenienciaDoZero("processos", undefined), "sem_fonte")
})

test("célula com dado não recebe procedência", () => {
  const cel = calcularCelulas(candidato({ sancoes: 2 }))
  assert.equal(cel.sancoes.state, "ok")
  assert.equal(cel.sancoes.proveniencia, undefined)
})

test("aplicarColetas distingue candidato ausente do log de log não lido", () => {
  const coorte = [candidato({ slug: "a" }), candidato({ slug: "b" })]

  assert.deepEqual(
    aplicarColetas(coorte, undefined).map((c) => c.coletas),
    [undefined, undefined],
    "sem log, ninguém recebe coletas"
  )

  const comLog = aplicarColetas(coorte, { a: { "transparencia-sanctions": "vazio_confirmado" } })
  assert.deepEqual(comLog[0].coletas, { "transparencia-sanctions": "vazio_confirmado" })
  assert.deepEqual(comLog[1].coletas, {}, "quem não aparece no log foi olhado e não tem tentativa")
  assert.equal(calcularCelulas(comLog[0]).sancoes.proveniencia, "vazio_confirmado")
  assert.equal(calcularCelulas(comLog[1]).sancoes.proveniencia, "nunca_verificado")
})

test("o mapa de fontes cobre exatamente as colunas de zero ambíguo", () => {
  // Coluna nova de zero sem entrada aqui sairia como procedência desconhecida
  // para sempre, sem ninguém perceber.
  assert.deepEqual(
    Object.keys(FONTES_POR_COLUNA).sort(),
    ["alertas", "cargos", "contradicoes", "partidos", "processos", "sancoes"]
  )
})
