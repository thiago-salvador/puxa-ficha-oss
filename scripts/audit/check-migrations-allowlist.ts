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
 *   tsx scripts/audit/check-migrations-allowlist.ts --desde=20260802200000 \
 *     --allowlist=scripts/audit/allowlist-governadores-ac.json
 *
 * ATENÇÃO AO `--desde`: ele é comparação de PREFIXO do nome do arquivo, não data.
 * Cada recorte precisa da própria janela, começando no timestamp da primeira
 * migration DELE, porque a allowlist de um recorte reprova legitimamente as
 * migrations de outro. Dois recortes nasceram em 2026-08-02: os presidenciáveis
 * em ...120000/130000/140000 e os governadores do AC em ...200000 em diante.
 * Rodar `--desde=20260802` com a allowlist do AC varre os dois e devolve 18
 * violações que não são defeito das migrations, e sim janela errada.
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

/** Statements de escrita sem anotação `@write` logo acima. */
export function escritasSemAnotacao(sql: string): { linha: number; texto: string }[] {
  const linhas = sql.split("\n")
  const orfas: { linha: number; texto: string }[] = []

  for (let i = 0; i < linhas.length; i += 1) {
    if (!ESCRITA.test(linhas[i])) continue
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

  const writes = lerPendingWrites(MIGRATIONS, desde)
  erros.push(...violacoesDeAllowlist(writes, allow))

  console.error(
    `[allowlist] ${arquivos.length} migration(s) na janela, ${comAnotacao} anotada(s), ${writes.length} write(s) declarado(s)`
  )
  for (const w of writes) {
    console.error(
      `  OK ${w.tabela}/${w.slug || `ref=${w.ref}`}${w.ano ? ` ano=${w.ano}` : ""}${w.tema ? ` tema=${w.tema}` : ""}${w.proposicao ? ` prop=${w.proposicao}` : ""} (${w.arquivo}:${w.linha})`
    )
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
