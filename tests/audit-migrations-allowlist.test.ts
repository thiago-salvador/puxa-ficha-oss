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

const LOTE_SQL = `-- @write tabela=pontos_atencao ref=familia-sem-mandato-eletivo campos=despublicacao_motivo,despublicado_em
UPDATE public.pontos_atencao
   SET despublicacao_motivo = 'familia-sem-mandato-eletivo: claim que o proprio banco contradiz.',
       despublicado_em = now()
 WHERE id IN ('367f4442-4146-4be0-b20a-30e89bc27337')
   AND visivel = false;
`

test("ref que abre um literal maior conta como mencionada no statement", () => {
  // Escrita em lote rotula a propria linha: o motivo gravado COMECA com a ref e
  // continua com a explicacao, entao o literal exato `'<ref>'` nunca aparece.
  // Antes desta forma, uma escrita corretamente declarada era rejeitada, e a
  // saida do gate empurrava para afrouxar a anotacao.
  const writes = parsePendingWrites(LOTE_SQL, "limpeza.sql")
  assert.equal(writes.length, 1)
  assert.equal(writes[0].ref, "familia-sem-mandato-eletivo")
  assert.deepEqual(writes[0].campos, ["despublicacao_motivo", "despublicado_em"])
})

test("a forma frouxa nao acredita em anotacao que o SQL nao sustenta", () => {
  // O identificador continua tendo que aparecer literal: trocar o rotulo dentro
  // do SQL volta a ser erro, senao o afrouxamento viraria um buraco no gate.
  const mentiroso = LOTE_SQL.replace("'familia-sem-mandato-eletivo:", "'outra-familia:")
  assert.throws(() => parsePendingWrites(mentiroso, "limpeza.sql"), /não menciona esse ref/)
})

test("ref mencionada so em comentario nao conta como statement", () => {
  // Comentario nao e escrita: o gate le o statement, nao a prosa em volta dele.
  const soComentario = `-- @write tabela=pontos_atencao ref=familia-sem-mandato-eletivo campos=despublicacao_motivo
-- contexto: 'familia-sem-mandato-eletivo: explicacao que vive so no comentario'
UPDATE public.pontos_atencao
   SET despublicacao_motivo = 'outra-coisa'
 WHERE visivel = false;
`
  assert.throws(() => parsePendingWrites(soComentario, "limpeza.sql"), /não menciona esse ref/)
})

test("escrita em tabela temporária do próprio arquivo não é escrita de produção", () => {
  // Regressao de 08/08/2026. O checker tratava INSERT em CREATE TEMP TABLE ...
  // ON COMMIT DROP como escrita em producao e exigia entrada de allowlist para um
  // dado que some no commit. Efeito: 20260805123929 reprovava em QUALQUER recorte
  // e o comando ficou vermelho desde 05/08. Gate que falha sempre para de ser lido,
  // e foi o que aconteceu: dois documentos declararam "allowlist OK" enquanto ele
  // nao passava.
  const sql = [
    "CREATE TEMP TABLE rascunho_x (id uuid PRIMARY KEY, decisao text) ON COMMIT DROP;",
    "",
    "INSERT INTO rascunho_x (id, decisao) VALUES ('11111111-1111-1111-1111-111111111111', 'aprovar');",
    "",
    "-- @write tabela=candidatos slug=lula campos=biografia",
    "UPDATE public.candidatos SET biografia = 'x' WHERE slug = 'lula';",
  ].join("\n")

  assert.deepEqual(
    escritasSemAnotacao(sql),
    [],
    "o INSERT na temporaria nao precisa de anotacao; o UPDATE em candidatos tem a dele",
  )

  const writes = parsePendingWrites(sql, "teste.sql")
  assert.equal(writes.length, 1, "so o UPDATE em tabela real entra no gate")
  assert.equal(writes[0].tabela, "candidatos")
})

test("escrita em tabela real continua exigindo anotação", () => {
  const sql = [
    "CREATE TEMP TABLE rascunho_y (id uuid) ON COMMIT DROP;",
    "UPDATE public.candidatos SET biografia = 'x' WHERE slug = 'lula';",
  ].join("\n")

  const orfas = escritasSemAnotacao(sql)
  assert.equal(orfas.length, 1, "a temporaria nao pode servir de disfarce para escrita real")
  assert.match(orfas[0].texto, /candidatos/)
})
