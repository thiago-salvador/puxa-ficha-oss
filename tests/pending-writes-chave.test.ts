import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { parsePendingWrites } from "../scripts/audit/lib/pending-writes"

/**
 * Escrita endereçada por chave (`-- @write ... chave=<literal>`).
 *
 * O gate `@write` existe para que nenhuma migration escreva em produção sem
 * declarar o que escreve. A regra original conferia a declaração exigindo que o
 * slug do candidato aparecesse LITERAL no statement, o que reprovava para
 * sempre uma classe inteira de escrita correta: a que endereça a linha pela
 * chave (`WHERE id = '<uuid>'`), onde o slug é conhecido só pela curadoria e
 * nunca aparece no SQL.
 *
 * Estes testes fixam os dois lados do contrato da forma nova. Ela ACEITA a
 * escrita por chave, e continua REPROVANDO anotação que não se prova contra o
 * SQL, que é a única coisa que o gate sabe verificar sem tocar banco.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations")

describe("pending-writes: escrita endereçada por chave", () => {
  it("(a) aceita chave= cujo literal aparece no statement", () => {
    const sql = [
      "-- @write tabela=posicoes_declaradas chave=ecb064e3-176e-404b-8182-430a62964df9 slug=flavio-bolsonaro campos=id",
      "DELETE FROM public.posicoes_declaradas",
      "WHERE id = 'ecb064e3-176e-404b-8182-430a62964df9';",
    ].join("\n")

    const writes = parsePendingWrites(sql, "teste.sql")

    assert.equal(writes.length, 1)
    assert.equal(writes[0].chave, "ecb064e3-176e-404b-8182-430a62964df9")
    // O slug segue declarado: a allowlist continua respondendo por ele.
    assert.equal(writes[0].slug, "flavio-bolsonaro")
  })

  it("(b) reprova quando o identificador declarado não aparece no statement", () => {
    // Chave declarada que não está no SQL: a anotação não se prova sozinha.
    const chaveInventada = [
      "-- @write tabela=posicoes_declaradas chave=00000000-0000-0000-0000-000000000000 slug=flavio-bolsonaro campos=id",
      "DELETE FROM public.posicoes_declaradas",
      "WHERE id = 'ecb064e3-176e-404b-8182-430a62964df9';",
    ].join("\n")
    assert.throws(
      () => parsePendingWrites(chaveInventada, "teste.sql"),
      /não menciona essa chave literal/
    )

    // Sem `chave=`, a regra antiga continua valendo inteira: slug tem que aparecer.
    const slugAusente = [
      "-- @write tabela=posicoes_declaradas slug=flavio-bolsonaro campos=id",
      "DELETE FROM public.posicoes_declaradas",
      "WHERE id = 'ecb064e3-176e-404b-8182-430a62964df9';",
    ].join("\n")
    assert.throws(() => parsePendingWrites(slugAusente, "teste.sql"), /não menciona esse slug/)

    // `chave=` não dispensa tabela nem slug/ref: acrescenta prova, não substitui.
    const semSlug = [
      "-- @write tabela=posicoes_declaradas chave=ecb064e3-176e-404b-8182-430a62964df9 campos=id",
      "DELETE FROM public.posicoes_declaradas",
      "WHERE id = 'ecb064e3-176e-404b-8182-430a62964df9';",
    ].join("\n")
    assert.throws(() => parsePendingWrites(semSlug, "teste.sql"), /sem tabela ou sem slug\/ref/)
  })

  it("(c) parseia a migration real 20260805123929 sem lançar", () => {
    const arquivo = "20260805123929_aplicar_decisoes_editoriais_20260805.sql"
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8")

    const writes = parsePendingWrites(sql, arquivo)

    assert.ok(writes.length > 0, "a migration declara escritas")
    const porChave = writes.filter((w) => w.chave !== undefined)
    assert.ok(
      porChave.length > 0,
      "as escritas desta migration são endereçadas por chave e precisam sair na seção separada"
    )
    // A anotação que derrubava o comando inteiro, agora declarada e conferida.
    const flavio = writes.find((w) => w.chave === "ecb064e3-176e-404b-8182-430a62964df9")
    assert.ok(flavio, "a anotação legada de flavio-bolsonaro parseia")
    assert.equal(flavio.tabela, "posicoes_declaradas")
  })

  it("(d) a chave tem que estar ancorada no literal, não solta no meio dele", () => {
    const ancorada = [
      '-- @write tabela=historico_politico chave="Candidatura a " ref=prefixo campos=cargo_canonico',
      "UPDATE public.historico_politico",
      "SET cargo_canonico = regexp_replace(cargo_canonico, '^Candidatura a ', '')",
      "WHERE cargo_canonico LIKE 'Candidatura a %';",
    ].join("\n")
    assert.equal(parsePendingWrites(ancorada, "teste.sql").length, 1)

    // "andidatura" está DENTRO do literal, mas não é começo nem fim dele.
    // Substring solta passaria a casar com qualquer texto grande da migration.
    const solta = [
      "-- @write tabela=historico_politico chave=andidatura ref=prefixo campos=cargo_canonico",
      "UPDATE public.historico_politico",
      "SET cargo_canonico = regexp_replace(cargo_canonico, '^Candidatura a ', '')",
      "WHERE cargo_canonico LIKE 'Candidatura a %';",
    ].join("\n")
    assert.throws(() => parsePendingWrites(solta, "teste.sql"), /não menciona essa chave literal/)
  })

  it("(e) statement em bloco dollar-quoted não é lido pela metade", () => {
    // O `;` de `DECLARE linhas integer;` fechava o statement cedo demais, e o
    // gate acusava que o SQL não mencionava a tabela anotada. Caso real de
    // 20260805137000: SQL correto, parser lendo só o cabeçalho do bloco.
    const sql = [
      "-- @write tabela=coleta_log slug=renato-gomes campos=detalhe",
      "DO $$",
      "DECLARE",
      "  linhas integer;",
      "BEGIN",
      "  UPDATE public.coleta_log",
      "  SET detalhe = 'corrigido'",
      "  WHERE alvo = 'renato-gomes';",
      "END $$;",
    ].join("\n")

    const writes = parsePendingWrites(sql, "teste.sql")

    assert.equal(writes.length, 1)
    assert.equal(writes[0].chave, undefined)
    assert.match(writes[0].statement, /END \$\$;$/)
  })
})
