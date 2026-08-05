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
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import {
  COLUNAS,
  COLUNAS_DO_INDICE,
  FONTES_POR_COLUNA,
  calcularCelulas,
  provenienciaDoZero,
  type CandidatoCoverage,
  type ColetaPorFonte,
} from "../scripts/audit/lib/coverage-model"
import type { UltimaColeta } from "../scripts/audit/lib/coleta-proveniencia"
import { removerBlocoDeColeta } from "../scripts/audit/lib/snapshot-fetch"

/** Candidato mínimo: tudo vazio, que é o cenário em que a procedência importa. */
function candidato(over: Partial<CandidatoCoverage> = {}): CandidatoCoverage {
  return {
    slug: "fulano",
    nome_urna: "Fulano",
    partido_sigla: "XPTO",
    cargo_disputado: "Governador",
    estado: "SP",
    foto: false,
    foto_origem: null,
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

type Desfecho = UltimaColeta["resultado"]

/** Todas as fontes de uma coluna com o mesmo desfecho. */
function todas(coluna: string, r: Desfecho): ColetaPorFonte {
  return Object.fromEntries(FONTES_POR_COLUNA[coluna].map((f) => [f, { resultado: r }]))
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

test("só vira zero provado quando toda fonte da coluna respondeu vazio", () => {
  assert.equal(provenienciaDoZero("sancoes", todas("sancoes", "vazio_confirmado")), "zero_provado")

  // `cargos` depende de quatro fontes; três não bastam.
  const parcial = { ...todas("cargos", "vazio_confirmado") }
  delete parcial[FONTES_POR_COLUNA.cargos[0]]
  assert.equal(provenienciaDoZero("cargos", parcial), "nunca_verificado")
})

test("uma falha rebaixa o veredito mesmo com as outras fontes confirmadas", () => {
  const comErro: ColetaPorFonte = { ...todas("alertas", "vazio_confirmado"), tcu: { resultado: "erro" } }
  assert.equal(provenienciaDoZero("alertas", comErro), "nao_sabemos")

  const semVeredito: ColetaPorFonte = {
    ...todas("alertas", "vazio_confirmado"),
    tcu: { resultado: "indeterminado" },
  }
  assert.equal(provenienciaDoZero("alertas", semVeredito), "nao_sabemos")
})

test("'nao_aplicavel' não impede o zero de ser confirmado", () => {
  // A fonte declarou que a pergunta não cabe para este alvo. Isso é resposta,
  // não silêncio, então não pode rebaixar o veredito das outras.
  const misto: ColetaPorFonte = {
    ...todas("partidos", "vazio_confirmado"),
    filiacao: { resultado: "nao_aplicavel" },
  }
  assert.equal(provenienciaDoZero("partidos", misto), "zero_provado")
})

test("'encontrado' com célula zerada não vira zero provado", () => {
  // A coleta trouxe dado e a ficha está vazia: o vazio é do recorte da régua
  // (uma cota antiga demais para a janela, por exemplo), e não da fonte. O que
  // não pode acontecer é esse zero sair vendido como confirmado.
  assert.equal(provenienciaDoZero("sancoes", todas("sancoes", "encontrado")), "coletado")
})

test("coluna sem ingest é 'sem fonte', e não promete coleta que não existe", () => {
  // Processos judiciais não têm ingest: os registros que existem vieram de
  // curadoria manual. Marcar como 'nunca verificado' sugeriria uma coleta
  // pendente de rodar, e não há nenhuma.
  assert.deepEqual(FONTES_POR_COLUNA.processos, [])
  assert.equal(provenienciaDoZero("processos", {}), "sem_ingest")
  assert.equal(provenienciaDoZero("processos", undefined), "sem_ingest")
})

test("célula com dado não recebe procedência", () => {
  const cel = calcularCelulas(candidato({ sancoes: 2 }))
  assert.equal(cel.sancoes.state, "ok")
  assert.equal(cel.sancoes.proveniencia, undefined)
})

test("origem técnica da foto não altera o índice nem presume direitos", () => {
  const local = calcularCelulas(candidato({ foto: true, foto_origem: "local" })).foto_origem
  const oficial = calcularCelulas(candidato({ foto: true, foto_origem: "tse" })).foto_origem
  const semFoto = calcularCelulas(candidato()).foto_origem

  assert.deepEqual({ state: local.state, text: local.text }, { state: "partial", text: "Local" })
  assert.match(local.tip ?? "", /não afirma autoria, licença ou titularidade/)
  assert.deepEqual({ state: oficial.state, text: oficial.text }, { state: "ok", text: "TSE" })
  assert.equal(semFoto.state, "na")
  assert.ok(!COLUNAS_DO_INDICE.includes("foto_origem" as never))
})

test("candidato sem tentativa e log não lido não se confundem na célula", () => {
  const comTentativa = candidato({
    coletas: { "transparencia-sanctions": { resultado: "vazio_confirmado" } },
  })
  const olhadoSemTentativa = candidato({ coletas: {} })

  assert.equal(calcularCelulas(comTentativa).sancoes.proveniencia, "zero_provado")
  assert.equal(calcularCelulas(olhadoSemTentativa).sancoes.proveniencia, "nunca_verificado")
  assert.equal(calcularCelulas(candidato()).sancoes.proveniencia, "desconhecida")
})

test("o bloco de coleta do SQL é removível, para banco sem a migration", () => {
  // A guarda não cabe dentro do SELECT (a relação é resolvida na análise do
  // comando), então a degradação depende destes marcadores. Renomeá-los sem
  // mexer no strip deixaria o relatório quebrado em banco novo.
  const sql = readFileSync(
    join(import.meta.dirname, "..", "scripts", "audit", "coverage-snapshot.sql"),
    "utf8"
  )
  assert.ok(sql.includes("from coleta_log_ultima"), "o SQL completo lê a view")

  const semColeta = removerBlocoDeColeta(sql)
  assert.ok(
    !semColeta.includes("from coleta_log_ultima"),
    "sem a migration, a view não pode ser referenciada por nenhuma cláusula"
  )
  assert.ok(semColeta.includes("'historico'"), "o resto do snapshot continua inteiro")
  assert.throws(() => removerBlocoDeColeta("select 1"), /marcadores/)
})

test("o mapa de fontes cobre todas as colunas do relatório", () => {
  // Coluna nova sem entrada aqui sairia como procedência desconhecida para
  // sempre, sem ninguém perceber. O mapa é canônico: ele descreve as 23 colunas
  // e não só as de zero ambíguo, então o teste cobra a lista inteira.
  const semMapa = COLUNAS.map((c) => c.key).filter((k) => !FONTES_POR_COLUNA[k])
  assert.deepEqual(semMapa, [], "coluna do relatório sem entrada em FONTES_POR_COLUNA")
})

test("o mapa lista todo ingest que escreve na tabela da coluna", () => {
  // Fonte a menos aqui é pior que fonte a mais: `zero_provado` exige que TODAS
  // as fontes tenham respondido, então esquecer uma faz um zero passar por
  // confirmado sem que ela tenha sido ouvida. Estes dois furos foram achados em
  // 04/08 comparando o mapa com quem escreve em cada tabela.
  assert.deepEqual(
    [...FONTES_POR_COLUNA.cargos].sort(),
    ["senado", "tse-historico", "wiki-historico", "wikidata-politico"],
    "historico_politico tem quatro escritores recorrentes"
  )
  assert.deepEqual(
    [...FONTES_POR_COLUNA.alertas].sort(),
    ["jarbas", "tcu", "transparencia-sanctions"],
    "pontos_atencao é escrita por três ingests, não é coluna derivada"
  )
})
