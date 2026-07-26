/**
 * Guard-rail contra atribuicao de candidatura por homonimo (2026-07-26).
 *
 * O `tse-resolver` ancora cada linha do TSE em tres degraus: SQ_CANDIDATO,
 * depois CPF, depois NOME. O degrau de nome era silencioso, e foi ele que
 * trouxe seis candidaturas de outra pessoa para a ficha de `jeronimo`, porque
 * o CPF divergente no cadastro desligou o degrau anterior.
 *
 * A regra que passa a valer: linha NOVA vinda de casamento por nome nasce fora
 * da superficie publica, esperando revisao. E, do outro lado, o re-ingest nao
 * pode reescrever esse estado numa linha que ja existe, senao desfaz revisao
 * humana em silencio, que e o mesmo defeito invertido.
 *
 * Estes testes verificam as duas metades, mais o filtro que faz a
 * despublicacao ter efeito na ficha.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { isWeakNameMatch } from "../scripts/lib/tse-resolver"

const ingestHistorico = readFileSync("scripts/lib/ingest-tse-historico.ts", "utf-8")
const api = readFileSync("src/lib/api.ts", "utf-8")

describe("guard-rail de homonimo no historico", () => {
  it("classifica como fraco apenas o casamento por nome", () => {
    assert.equal(isWeakNameMatch("name-unique"), true)
    assert.equal(isWeakNameMatch("name-uf"), true)
    assert.equal(isWeakNameMatch("cpf"), false)
    assert.equal(isWeakNameMatch("sq-preloaded"), false)
  })

  it("marca a linha nova resolvida por nome como despublicada", () => {
    const trechoInsert = ingestHistorico.slice(
      ingestHistorico.indexOf('.from("historico_politico")\n            .insert(')
    )

    assert.match(
      trechoInsert.slice(0, 800),
      /despublicado_em:\s*resolvidoPorNome/,
      "o insert precisa marcar despublicado_em quando a ancora foi o nome",
    )
    assert.match(
      trechoInsert.slice(0, 800),
      /despublicacao_motivo:\s*resolvidoPorNome/,
      "o motivo tem de acompanhar a marcacao, senao ninguem sabe por que a linha sumiu",
    )
  })

  it("nao reescreve o estado de despublicacao no re-ingest de linha existente", () => {
    const inicioUpdate = ingestHistorico.indexOf("if (existing) {")
    const fimUpdate = ingestHistorico.indexOf("} else {", inicioUpdate)
    const trechoUpdate = ingestHistorico.slice(inicioUpdate, fimUpdate)

    assert.doesNotMatch(
      trechoUpdate,
      /despublicado_em/,
      "o caminho de update nao pode tocar despublicado_em: desfaria revisao humana a cada re-ingest",
    )
    assert.doesNotMatch(
      trechoUpdate,
      /despublicacao_motivo/,
      "o caminho de update nao pode tocar despublicacao_motivo pelo mesmo motivo",
    )
  })

  it("a ficha publica filtra as linhas despublicadas", () => {
    const inicio = api.indexOf('withSupabaseRetry(`historico_politico(')
    assert.notEqual(inicio, -1, "a consulta de historico_politico precisa existir em api.ts")

    assert.match(
      api.slice(inicio, inicio + 500),
      /\.is\("despublicado_em",\s*null\)/,
      "sem este filtro a despublicacao nao tem efeito nenhum na ficha",
    )
  })
})
