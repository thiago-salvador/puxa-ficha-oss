/**
 * Confere as migrations desta branch contra a allowlist (2026-08-02).
 *
 * Duas checagens independentes, ambas obrigatórias:
 *   1. TODO statement de escrita (INSERT / UPDATE / DELETE) das migrations
 *      selecionadas tem uma anotação `-- @write` imediatamente acima. Statement
 *      de escrita sem anotação é erro: seria escrita invisível para o gate.
 *   2. TODA anotação `-- @write` está contida na allowlist informada, casando tabela, slug e,
 *      quando a allowlist especifica, ano, tema ou teto de registros. Escrita em
 *      tabela de referência é anotada com `ref=` e conferida contra o bloco
 *      `referencias`.
 *
 * Não toca banco nem rede. Sai != 0 na primeira violação.
 *
 * Uso:
 *   tsx scripts/audit/check-migrations-allowlist.ts \
 *     --desde=20260802200000 --ate=20260802200100 \
 *     --allowlist=scripts/audit/allowlist-governadores-ac.json
 *
 * ATENÇÃO À JANELA: `--desde` e `--ate` são comparação de PREFIXO do nome do
 * arquivo, não data, e `--ate` é inclusivo. Cada recorte precisa da própria
 * janela, porque a allowlist de um recorte reprova legitimamente as migrations
 * de outro. Rodar `--desde=20260802` com a allowlist do AC varre também os
 * presidenciáveis e devolve 18 violações que não são defeito das migrations.
 *
 * `--ate` existe porque `--desde` sozinho não tem teto, então TODO recorte
 * criado depois entra na janela dos anteriores. Isso mordeu quatro vezes entre
 * 02 e 03/08/2026: AC contra presidenciáveis, e depois a migration das 33
 * claims caindo na janela do recorte de AL. Sem teto, uma janela correta hoje
 * quebra sozinha amanhã, quando alguém criar a próxima migration.
 *
 * Janelas dos recortes existentes:
 *   presidenciáveis  --desde=20260803100000 --ate=20260803110000
 *   governadores AC  --desde=20260802200000 --ate=20260802200100
 *   governadores AL  --desde=20260803080000 --ate=20260803080000
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

import { lerPendingWrites, type PendingWrite } from "./lib/pending-writes"

const RAIZ = resolve(import.meta.dirname, "..", "..")
const MIGRATIONS = join(RAIZ, "supabase", "migrations")

interface AllowEntry {
  tabela: string
  slug: string
  ano?: number
  temas?: string[]
  max_registros?: number
  campos: string[]
}

/**
 * Escrita permitida em tabela de REFERÊNCIA (sem candidato dono), declarada na
 * migration com `ref=` em vez de `slug=`. Fica em bloco separado de propósito:
 * `coorte` governa de quem se pode falar, e correção de referência não pertence
 * a ninguém da coorte.
 */
interface AllowRef {
  tabela: string
  ref: string
  campos: string[]
}

interface Allowlist {
  coorte: string[]
  fora_por_construcao: { slugs: string[] }
  entries: AllowEntry[]
  referencias?: AllowRef[]
}

const ESCRITA = /^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i

/**
 * Tabelas temporárias declaradas no próprio arquivo.
 *
 * `CREATE TEMP TABLE ... ON COMMIT DROP` é rascunho: existe dentro da transação
 * da migration, some no commit e nunca chega à superfície pública. Escrever nela
 * não é escrita em produção, e exigir entrada de allowlist para isso é pedir que
 * alguém declare um dado que não persiste.
 *
 * Isso não é conveniência, é precisão do gate. Enquanto o checker tratava
 * rascunho como produção, `20260805123929` reprovava em qualquer recorte, e o
 * comando inteiro ficou vermelho desde 05/08/2026. Um gate que falha sempre para
 * de ser lido, e foi o que aconteceu: dois documentos declararam "allowlist OK"
 * enquanto ele não passava. Gate barulhento é gate desligado.
 */
export function tabelasTemporarias(sql: string): Set<string> {
  const encontradas = new Set<string>()
  const padrao = /\bCREATE\s+(?:GLOBAL\s+|LOCAL\s+)?TEMP(?:ORARY)?\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w$]*)/gi
  for (const m of sql.matchAll(padrao)) encontradas.add(m[1].toLowerCase())
  return encontradas
}

/** O statement escreve numa tabela temporária declarada neste mesmo arquivo? */
export function escreveEmTemporaria(statement: string, temporarias: Set<string>): boolean {
  if (temporarias.size === 0) return false
  const alvo =
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?([a-zA-Z_][\w$]*)/i.exec(statement)
  return alvo ? temporarias.has(alvo[1].toLowerCase()) : false
}

/** Statements de escrita sem anotação `@write` logo acima. */
export function escritasSemAnotacao(sql: string): { linha: number; texto: string }[] {
  const linhas = sql.split("\n")
  const orfas: { linha: number; texto: string }[] = []
  const temporarias = tabelasTemporarias(sql)

  for (let i = 0; i < linhas.length; i += 1) {
    if (!ESCRITA.test(linhas[i])) continue
    if (escreveEmTemporaria(linhas[i], temporarias)) continue
    let j = i - 1
    let anotada = false
    // Sobe por linhas em branco e comentários até achar (ou não) a anotação.
    while (j >= 0) {
      const t = linhas[j].trim()
      if (t === "") { j -= 1; continue }
      if (t.startsWith("--")) {
        if (/^--\s*@write\b/.test(t)) { anotada = true; break }
        j -= 1
        continue
      }
      break
    }
    if (!anotada) orfas.push({ linha: i + 1, texto: linhas[i].trim().slice(0, 120) })
  }
  return orfas
}

export function violacoesDeAllowlist(writes: PendingWrite[], allow: Allowlist): string[] {
  const erros: string[] = []
  const bloqueados = new Set(allow.fora_por_construcao.slugs)
  const contagemPorEntrada = new Map<AllowEntry, number>()

  for (const w of writes) {
    if (w.ref !== undefined) {
      const entrada = (allow.referencias ?? []).find(
        (e) => e.tabela === w.tabela && e.ref === w.ref
      )
      if (!entrada) {
        erros.push(
          `${w.arquivo}:${w.linha}: referência (${w.tabela}, ref=${w.ref}) não está no bloco referencias da allowlist`
        )
        continue
      }
      const fora = w.campos.filter((c) => !entrada.campos.includes(c))
      if (fora.length) {
        erros.push(
          `${w.arquivo}:${w.linha}: campos fora da allowlist para ${w.tabela}/ref=${w.ref}: ${fora.join(", ")}`
        )
      }
      continue
    }

    if (!allow.coorte.includes(w.slug)) {
      erros.push(`${w.arquivo}:${w.linha}: slug ${w.slug} está fora da coorte da allowlist`)
      continue
    }
    if (bloqueados.has(w.slug)) {
      erros.push(`${w.arquivo}:${w.linha}: slug ${w.slug} está fora por construção`)
      continue
    }

    const candidatas = allow.entries.filter((e) => e.tabela === w.tabela && e.slug === w.slug)
    if (!candidatas.length) {
      erros.push(`${w.arquivo}:${w.linha}: (${w.tabela}, ${w.slug}) não está na allowlist`)
      continue
    }

    const entrada = candidatas.find((e) => {
      if (e.ano !== undefined && e.ano !== w.ano) return false
      if (e.temas && (!w.tema || !e.temas.includes(w.tema))) return false
      return true
    })
    if (!entrada) {
      erros.push(
        `${w.arquivo}:${w.linha}: (${w.tabela}, ${w.slug}, ano=${w.ano ?? "-"}, tema=${w.tema ?? "-"}) não casa com nenhuma entrada da allowlist`
      )
      continue
    }

    const foraDoCampo = w.campos.filter((c) => !entrada.campos.includes(c))
    if (foraDoCampo.length) {
      erros.push(
        `${w.arquivo}:${w.linha}: campos fora da allowlist para ${w.tabela}/${w.slug}: ${foraDoCampo.join(", ")}`
      )
    }

    const n = (contagemPorEntrada.get(entrada) ?? 0) + 1
    contagemPorEntrada.set(entrada, n)
    if (entrada.max_registros !== undefined && n > entrada.max_registros) {
      erros.push(
        `${w.arquivo}:${w.linha}: ${w.tabela}/${w.slug} excede max_registros=${entrada.max_registros}`
      )
    }
  }

  return erros
}

function main(): void {
  const argv = process.argv.slice(2)
  const desdeFlag = argv.find((a) => a.startsWith("--desde="))
  const desde = desdeFlag ? desdeFlag.slice("--desde=".length) : undefined
  const ateFlag = argv.find((a) => a.startsWith("--ate="))
  const ate = ateFlag ? ateFlag.slice("--ate=".length) : undefined
  const allowlistFlag = argv.find((a) => a.startsWith("--allowlist="))
  const allowlistPath = allowlistFlag
    ? allowlistFlag.slice("--allowlist=".length)
    : "scripts/audit/allowlist-presidenciaveis.json"

  const allow = JSON.parse(
    readFileSync(resolve(RAIZ, allowlistPath), "utf8")
  ) as Allowlist

  const arquivos = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (desde ? f >= desde : true))
    .filter((f) => (ate ? f <= `${ate}￿` : true))
    .sort()

  const erros: string[] = []
  let comAnotacao = 0

  for (const arquivo of arquivos) {
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8")
    if (!sql.includes("@write")) {
      // Migration da janela sem nenhuma anotação: só é aceitável se não escrever nada.
      const orfas = escritasSemAnotacao(sql)
      if (orfas.length) {
        erros.push(
          `${arquivo}: ${orfas.length} statement(s) de escrita sem anotação @write (linha ${orfas[0].linha}: ${orfas[0].texto})`
        )
      }
      continue
    }
    comAnotacao += 1
    for (const o of escritasSemAnotacao(sql)) {
      erros.push(`${arquivo}:${o.linha}: statement de escrita sem anotação @write -> ${o.texto}`)
    }
  }

  const writes = lerPendingWrites(MIGRATIONS, desde, ate)
  erros.push(...violacoesDeAllowlist(writes, allow))

  // Duas listas, nunca uma só. Escrita endereçada por chave (`chave=`) tem o
  // identificador provado contra o SQL, mas o slug declarado NÃO: resolver
  // `chave='<uuid>'` para um candidato exige o banco, e este checker não toca
  // banco. Misturar as duas na mesma lista de `OK` faria o relatório afirmar
  // uma prova que não existe. Seção separada é o preço de aceitar a forma:
  // a escrita fica visível e nomeada para revisão humana, em vez de aceita
  // em silêncio no meio de duzentas linhas iguais.
  const verificadas = writes.filter((w) => w.chave === undefined)
  const porChave = writes.filter((w) => w.chave !== undefined)

  const descreve = (w: PendingWrite): string =>
    `${w.tabela}/${w.slug || `ref=${w.ref}`}${w.ano ? ` ano=${w.ano}` : ""}${w.tema ? ` tema=${w.tema}` : ""}${w.proposicao ? ` prop=${w.proposicao}` : ""} (${w.arquivo}:${w.linha})`

  console.error(
    `[allowlist] ${arquivos.length} migration(s) na janela, ${comAnotacao} anotada(s), ${writes.length} write(s) declarado(s)` +
      `, ${verificadas.length} com identificador conferido no SQL, ${porChave.length} endereçado(s) por chave`
  )
  for (const w of verificadas) console.error(`  OK ${descreve(w)}`)

  if (porChave.length) {
    console.error(
      `\n[nao verificavel estaticamente] ${porChave.length} escrita(s) endereçada(s) por chave.` +
        ` A chave declarada aparece literal no SQL; o slug/ref declarado NÃO, e só a allowlist responde por ele.`
    )
    for (const w of porChave) console.error(`  CHAVE chave=${w.chave} ${descreve(w)}`)
  }

  if (erros.length) {
    console.error(`\n${erros.length} violação(ões):`)
    for (const e of erros) console.error(`  FAIL ${e}`)
    process.exit(1)
  }
  console.error("\nOK: toda escrita declarada está dentro da allowlist.")
}

if (import.meta.filename === process.argv[1]) {
  main()
}
