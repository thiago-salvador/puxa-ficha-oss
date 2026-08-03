import test from "node:test"
import assert from "node:assert/strict"

import { parsePendingWrites } from "../scripts/audit/lib/pending-writes"
import {
  escritasSemAnotacao,
  violacoesDeAllowlist,
} from "../scripts/audit/check-migrations-allowlist"

const ALLOW = {
  coorte: ["mailza-assis", "thor-dantas"],
  fora_por_construcao: { slugs: [] as string[] },
  entries: [
    { tabela: "patrimonio", slug: "thor-dantas", ano: 2022, campos: ["bens", "fonte"] },
  ],
  referencias: [{ tabela: "votacoes_chave", ref: "146740", campos: ["proposicao_id"] }],
}

const REF_SQL = `-- @write tabela=votacoes_chave ref=146740 campos=proposicao_id
UPDATE public.votacoes_chave
   SET proposicao_id = '146740'
 WHERE proposicao_id = '150041';
`

test("escrita em tabela de referência é declarada, não invisível para o gate", () => {
  // Sem a anotação, o statement seria escrita órfã: é isso que o gate existe
  // para impedir, e o caminho de referência não pode virar um buraco nele.
  const semAnotacao = REF_SQL.split("\n").slice(1).join("\n")
  assert.equal(escritasSemAnotacao(semAnotacao).length, 1)
  assert.equal(escritasSemAnotacao(REF_SQL).length, 0)
})

test("ref declarada e presente na allowlist passa", () => {
  const writes = parsePendingWrites(REF_SQL, "fix.sql")
  assert.equal(writes.length, 1)
  assert.equal(writes[0].ref, "146740")
  assert.equal(writes[0].slug, "")
  assert.deepEqual(violacoesDeAllowlist(writes, ALLOW), [])
})

test("ref fora da allowlist é violação, e não passa pela porta da coorte", () => {
  const sql = REF_SQL.replace(/146740/g, "999999")
  const writes = parsePendingWrites(sql, "fix.sql")
  const erros = violacoesDeAllowlist(writes, ALLOW)
  assert.equal(erros.length, 1)
  assert.match(erros[0], /não está no bloco referencias/)
})

test("campo fora da allowlist é violação mesmo com a ref permitida", () => {
  const sql = REF_SQL.replace("campos=proposicao_id", "campos=proposicao_id,titulo")
  const erros = violacoesDeAllowlist(parsePendingWrites(sql, "fix.sql"), ALLOW)
  assert.equal(erros.length, 1)
  assert.match(erros[0], /campos fora da allowlist/)
})

test("allowlist sem bloco referencias reprova qualquer ref", () => {
  const semRef = { ...ALLOW, referencias: undefined }
  const erros = violacoesDeAllowlist(parsePendingWrites(REF_SQL, "fix.sql"), semRef)
  assert.equal(erros.length, 1)
})

test("anotação de ref exige que o statement mencione a própria ref", () => {
  // Anotação que não bate com o SQL é erro, não silêncio: mesma garantia que já
  // valia para slug.
  const mentiroso = REF_SQL.replace("SET proposicao_id = '146740'", "SET proposicao_id = '111111'")
  assert.throws(
    () => parsePendingWrites(mentiroso, "fix.sql"),
    /não menciona esse ref/
  )
})

test("slug e ref na mesma anotação é erro", () => {
  const ambos = REF_SQL.replace("ref=146740", "slug=mailza-assis ref=146740")
  assert.throws(() => parsePendingWrites(ambos, "fix.sql"), /slug e ref ao mesmo tempo/)
})

test("anotação sem slug e sem ref continua sendo erro", () => {
  const nenhum = REF_SQL.replace("ref=146740 ", "")
  assert.throws(() => parsePendingWrites(nenhum, "fix.sql"), /sem slug\/ref/)
})

test("escrita de candidato segue conferida contra a coorte", () => {
  const sql = `-- @write tabela=patrimonio slug=fulano-de-tal ano=2022 campos=bens
UPDATE public.patrimonio p SET bens = '[]'::jsonb
FROM public.candidatos c WHERE c.slug = 'fulano-de-tal';
`
  const erros = violacoesDeAllowlist(parsePendingWrites(sql, "x.sql"), ALLOW)
  assert.equal(erros.length, 1)
  assert.match(erros[0], /fora da coorte/)
})
