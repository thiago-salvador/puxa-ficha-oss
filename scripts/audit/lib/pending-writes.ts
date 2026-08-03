/**
 * Leitura das migrations ainda **não aplicadas** em produção (2026-08-02).
 *
 * Migrations de dado geradas por este fluxo carregam, antes de cada statement,
 * uma linha de anotação legível por máquina:
 *
 *   -- @write tabela=patrimonio slug=hertz-dias ano=2020 campos=valor_total,bens
 *
 * A anotação existe para dois consumidores:
 *   1. `coverage-report.ts --com-migrations-pendentes`, que sobrepõe o efeito
 *      planejado ao snapshot de produção e mostra como a cobertura fica DEPOIS
 *      da aplicação, sem escrever nada;
 *   2. `check-migrations-allowlist.ts`, que confere statement a statement contra
 *      `allowlist-presidenciaveis.json`.
 *
 * A anotação nunca é acreditada sozinha: o parser exige que o statement logo
 * abaixo mencione a mesma tabela e o mesmo slug. Anotação que não bate com o SQL
 * vira erro, não silêncio.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export interface PendingWrite {
  arquivo: string
  linha: number
  tabela: string
  /** Vazio quando a escrita é de tabela de referência (ver `ref`). */
  slug: string
  ano?: number
  tema?: string
  proposicao?: string
  /**
   * Escrita em tabela de REFERÊNCIA, que não pertence a um candidato
   * (`votacoes_chave`, por exemplo). Anotada com `ref=<identificador>` em vez de
   * `slug=`, e conferida contra o bloco `referencias` da allowlist. Existe para
   * que correção de dado de referência continue sendo escrita DECLARADA, em vez
   * de escapar do gate por não ter slug para declarar.
   */
  ref?: string
  campos: string[]
  /** Statement SQL bruto associado à anotação. */
  statement: string
}

const ANOTACAO = /^--\s*@write\s+(.+)$/

function parseAtributos(texto: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const par of texto.trim().split(/\s+/)) {
    const idx = par.indexOf("=")
    if (idx <= 0) continue
    out[par.slice(0, idx)] = par.slice(idx + 1)
  }
  return out
}

/**
 * Extrai o statement que começa na primeira linha não vazia e não comentada,
 * até o primeiro `;` FORA de string literal. Ponto e vírgula dentro de aspas
 * simples é conteúdo (aparece em texto de `descricao`, por exemplo) e não
 * termina o statement.
 */
function statementApos(linhas: string[], inicio: number): string {
  const buffer: string[] = []
  let dentroDeAspas = false

  for (let i = inicio; i < linhas.length; i += 1) {
    const linha = linhas[i]
    if (buffer.length === 0 && (linha.trim() === "" || linha.trim().startsWith("--"))) continue
    buffer.push(linha)

    let fim = false
    for (let k = 0; k < linha.length; k += 1) {
      const ch = linha[k]
      if (ch === "'") {
        // `''` é aspa escapada dentro da string, não fecha.
        if (dentroDeAspas && linha[k + 1] === "'") { k += 1; continue }
        dentroDeAspas = !dentroDeAspas
        continue
      }
      if (ch === ";" && !dentroDeAspas) { fim = true; break }
    }
    if (fim) break
  }
  return buffer.join("\n").trim()
}

export function parsePendingWrites(sql: string, arquivo: string): PendingWrite[] {
  const linhas = sql.split("\n")
  const writes: PendingWrite[] = []

  for (let i = 0; i < linhas.length; i += 1) {
    const m = ANOTACAO.exec(linhas[i].trim())
    if (!m) continue

    const attrs = parseAtributos(m[1])
    const tabela = attrs.tabela ?? ""
    const slug = attrs.slug ?? ""
    const ref = attrs.ref
    if (slug && ref !== undefined) {
      throw new Error(
        `${arquivo}:${i + 1}: anotação @write tem slug e ref ao mesmo tempo; use um ou outro`
      )
    }
    if (!tabela || (!slug && !ref)) {
      throw new Error(`${arquivo}:${i + 1}: anotação @write sem tabela ou sem slug/ref`)
    }

    const statement = statementApos(linhas, i + 1)
    if (!statement) {
      throw new Error(`${arquivo}:${i + 1}: anotação @write sem statement logo abaixo`)
    }
    if (!statement.includes(tabela)) {
      throw new Error(
        `${arquivo}:${i + 1}: anotação diz tabela=${tabela} mas o statement não menciona essa tabela`
      )
    }
    // A anotação nunca é acreditada sozinha: o statement tem que mencionar o
    // mesmo identificador que ela declara, seja slug de candidato ou ref.
    const identificador = slug || (ref as string)
    const rotulo = slug ? "slug" : "ref"
    if (!statement.includes(`'${identificador}'`)) {
      throw new Error(
        `${arquivo}:${i + 1}: anotação diz ${rotulo}=${identificador} mas o statement não menciona esse ${rotulo}`
      )
    }

    writes.push({
      arquivo,
      linha: i + 1,
      tabela,
      slug,
      ano: attrs.ano ? Number(attrs.ano) : undefined,
      tema: attrs.tema,
      proposicao: attrs.proposicao,
      ref,
      campos: attrs.campos ? attrs.campos.split(",").filter(Boolean) : [],
      statement,
    })
  }

  return writes
}

/**
 * Lê todas as migrations do diretório e devolve as anotadas.
 * `desde` filtra por prefixo de timestamp (nome do arquivo), para restringir às
 * migrations criadas nesta branch.
 */
export function lerPendingWrites(dir: string, desde?: string): PendingWrite[] {
  const arquivos = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (desde ? f >= desde : true))
    .sort()

  const writes: PendingWrite[] = []
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(dir, arquivo), "utf8")
    if (!sql.includes("@write")) continue
    writes.push(...parsePendingWrites(sql, arquivo))
  }
  return writes
}
