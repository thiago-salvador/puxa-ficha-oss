/**
 * Guarda de UF no degrau de SQ_CANDIDATO do resolver.
 *
 * O caminho por NOME sempre teve essa guarda, com um comentario no codigo
 * dizendo que ela e "load-bearing for homonym prevention". O caminho por SQ
 * nao tinha, e e o degrau de MAIOR prioridade: ele nao degrada para o
 * proximo, ancora direto.
 *
 * Isso importa porque ate 2008 o SQ_CANDIDATO do TSE nao e chave global, e sim
 * sequencial POR UF. Valores curtos como "10354" existem em quase todos os
 * estados, apontando para pessoas diferentes. Um SQ curto no seed casava com a
 * primeira linha que tivesse aquele numero em qualquer UF.
 *
 * Descoberto em 2026-07-26 ao escrever o auditor de SQ: a primeira versao dele
 * tinha exatamente o mesmo defeito e acusou 40 falsos positivos, todos casando
 * com candidatos do Acre, primeiro arquivo em ordem alfabetica.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const resolver = readFileSync("scripts/lib/tse-resolver.ts", "utf-8")

/** Recorta o bloco do degrau de SQ dentro de `resolveRow`. */
function blocoDoDegrauSq(): string {
  const inicio = resolver.indexOf("const sq = (row.SQ_CANDIDATO")
  assert.notEqual(inicio, -1, "o degrau de SQ precisa existir em resolveRow")
  const fim = resolver.indexOf("const cpf = normalizeCPF", inicio)
  assert.notEqual(fim, -1, "o degrau de CPF deveria vir logo depois do de SQ")
  return resolver.slice(inicio, fim)
}

describe("tse-resolver: guarda de UF no degrau de SQ", () => {
  it("o indice de SQ carrega a UF do candidato, nao so o slug", () => {
    assert.match(
      resolver,
      /sqToCandidato\s*=\s*new Map<string,\s*\{\s*slug:\s*string;\s*estado:\s*string\s*\}>/,
      "sem a UF no indice nao ha como comparar com a linha do TSE",
    )
    assert.doesNotMatch(
      resolver,
      /sqToSlug/,
      "o mapa antigo, que guardava so o slug, nao pode voltar",
    )
  })

  it("o degrau de SQ compara a UF da linha com a do candidato", () => {
    const bloco = blocoDoDegrauSq()
    assert.match(bloco, /row\.SG_UF/, "precisa ler a UF da linha do TSE")
    assert.match(
      bloco,
      /candidato\.estado/,
      "precisa comparar com a UF declarada do candidato",
    )
  })

  it("nao ancora por SQ quando a UF diverge", () => {
    const bloco = blocoDoDegrauSq()

    // O retorno de sucesso tem de estar condicionado a guarda, e nao solto.
    const posGuarda = bloco.indexOf("ufDivergeNoSq")
    const posRetorno = bloco.indexOf('method: "sq-preloaded"')
    assert.notEqual(posGuarda, -1, "a guarda precisa existir")
    assert.notEqual(posRetorno, -1, "o retorno do degrau de SQ precisa existir")
    assert.ok(
      posGuarda < posRetorno,
      "a guarda tem de ser avaliada antes de ancorar por SQ",
    )
    assert.match(
      bloco,
      /if\s*\(!ufDivergeNoSq\)/,
      "o retorno por SQ tem de estar dentro da condicao de UF compativel",
    )
  })

  it("mantem a guarda de UF que o caminho por nome ja tinha", () => {
    // Protecao contra a regressao inversa: alguem 'simplificar' as duas.
    assert.match(
      resolver,
      /load-bearing for homonym prevention/,
      "a guarda do caminho por nome nao pode ser removida",
    )
  })
})
