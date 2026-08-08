import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

/**
 * As migrations da completude estao RETIDAS por decisao do dono: escrevem em
 * producao e pertencem a um gate proprio. Ate 08/08/2026 esse gate existia
 * apenas como frase em Settings/STATUS.md, e nada impedia um
 * `supabase db push` de qualquer maquina aplicar as cinco de uma vez.
 *
 * Agrava: o timestamp delas e ANTERIOR ao de oito migrations ja aplicadas
 * (`20260807054000` a `20260808010000`), entao um push as aplicaria fora de
 * ordem em relacao ao estado real do banco.
 *
 * Este teste nao substitui um hook: ele garante que a retencao esteja escrita
 * no proprio arquivo, para quem for rodar o push ler o aviso antes, e que a
 * lista nao mude em silencio. Liberar uma migration daqui e ato deliberado:
 * remova o slug da lista, remova o aviso do arquivo e registre a decisao.
 */
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations")

const RETIDAS = [
  "20260807050000",
  "20260807051000",
  "20260807052000",
  "20260807052500",
  "20260807053000",
] as const

const MARCADOR = "MIGRATION RETIDA"

function arquivoDaVersao(versao: string): string | undefined {
  return readdirSync(MIGRATIONS_DIR).find((nome) => nome.startsWith(`${versao}_`))
}

describe("gate das migrations retidas da completude", () => {
  it("as cinco continuam existindo como arquivo", () => {
    for (const versao of RETIDAS) {
      assert.ok(
        arquivoDaVersao(versao),
        `${versao} desapareceu. Se foi renomeada ou removida, a decisao precisa estar registrada em Settings/STATUS.md e esta lista atualizada no mesmo commit.`,
      )
    }
  })

  it("cada uma avisa no topo do arquivo que esta retida", () => {
    for (const versao of RETIDAS) {
      const nome = arquivoDaVersao(versao)
      assert.ok(nome, `${versao} nao encontrada`)
      const conteudo = readFileSync(join(MIGRATIONS_DIR, nome), "utf8")
      const cabecalho = conteudo.split("\n").slice(0, 12).join("\n")
      assert.ok(
        cabecalho.includes(MARCADOR),
        `${nome} nao traz "${MARCADOR}" nas 12 primeiras linhas. Quem abrir o arquivo, ou rodar um push, precisa ver o aviso antes de aplicar.`,
      )
    }
  })

  it("nenhuma migration nova reusa um dos timestamps retidos", () => {
    const versoes = readdirSync(MIGRATIONS_DIR)
      .filter((nome) => nome.endsWith(".sql"))
      .map((nome) => nome.split("_", 1)[0])

    for (const versao of RETIDAS) {
      const ocorrencias = versoes.filter((v) => v === versao).length
      assert.equal(
        ocorrencias,
        1,
        `${versao} aparece ${ocorrencias} vezes. Duas migrations com o mesmo timestamp deixam a ordem ambigua.`,
      )
    }
  })
})
