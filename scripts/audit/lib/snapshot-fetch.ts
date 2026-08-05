/**
 * Obtenção do snapshot de cobertura direto do banco de produção (2026-08-04).
 *
 * Existe para que `npm run audit:cobertura` rode ponta a ponta em um comando.
 * Entre 02/08 e 04/08 o relatório não rodava sozinho: o caminho que lia o banco
 * pelo supabase-js foi removido em 02/08 (com razão: reimplementava em JS as
 * janelas e uniões da régua, criando duas verdades), e o que sobrou exigia
 * colar o resultado do SQL num arquivo à mão.
 *
 * Este módulo não reimplementa nada. Ele lê `coverage-snapshot.sql` como texto e
 * manda o arquivo inteiro para o banco executar. A régua continua tendo uma
 * fonte só: o .sql para os fatos, `coverage-model.ts` para a classificação.
 *
 * Transporte: a Management API do Supabase (`/v1/projects/:ref/database/query`),
 * a mesma que o MCP do Supabase usa, sempre com `read_only: true` — o servidor
 * abre a transação em modo somente leitura e recusa qualquer escrita, então o
 * caminho não consegue tocar em produção nem por engano.
 *
 * A API REST do projeto (PostgREST, `SUPABASE_URL` + service role) NÃO serve
 * aqui: ela expõe tabelas e RPCs declaradas, não SQL arbitrário, e responde 403
 * a um token de CLI. É por isso que a credencial usada é o Personal Access Token
 * (`sbp_…`), não a service role key.
 *
 * Credencial, na ordem:
 *   1. `SUPABASE_ACCESS_TOKEN` no ambiente (é a variável oficial do CLI, e é o
 *      caminho para CI ou para outra máquina);
 *   2. no macOS, o token que `supabase login` já guardou no Keychain.
 *
 * Ver `docs/cobertura-de-dados.md`.
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

/** Projeto de produção do Puxa Ficha. */
export const PROJECT_REF_PADRAO = "wskpzsobvqwhnbsdsmok"

const SERVICO_KEYCHAIN = "Supabase CLI"
/** Prefixo que o go-keyring (usado pelo CLI do Supabase) põe no valor guardado. */
const PREFIXO_GO_KEYRING = "go-keyring-base64:"

/** Lê o token que `supabase login` guardou no Keychain do macOS. */
function tokenDoKeychain(): string | null {
  if (process.platform !== "darwin") return null
  try {
    const bruto = execFileSync("security", ["find-generic-password", "-s", SERVICO_KEYCHAIN, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (!bruto) return null
    return bruto.startsWith(PREFIXO_GO_KEYRING)
      ? Buffer.from(bruto.slice(PREFIXO_GO_KEYRING.length), "base64").toString("utf8").trim()
      : bruto
  } catch {
    return null
  }
}

export function resolverToken(): string {
  const doAmbiente = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (doAmbiente) return doAmbiente

  const doKeychain = tokenDoKeychain()
  if (doKeychain) return doKeychain

  throw new Error(
    "Sem credencial para ler o banco. Rode `supabase login` (o token fica no Keychain) " +
      "ou exporte SUPABASE_ACCESS_TOKEN=sbp_… . Ver docs/cobertura-de-dados.md."
  )
}

/**
 * Executa SQL somente leitura no banco de produção e devolve as linhas.
 * `read_only` é imposto pelo servidor, não por confiança neste código.
 */
export async function consultar<T>(sql: string, ref: string, token: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  })

  const texto = await r.text()
  if (!r.ok) {
    const dica =
      r.status === 401 || r.status === 403
        ? " Token sem acesso a este projeto: refaça `supabase login`."
        : ""
    throw new Error(`Management API respondeu HTTP ${r.status}: ${texto.slice(0, 400)}${dica}`)
  }
  return JSON.parse(texto) as T[]
}

const MARCA_COLETA_INICIO = "-- @coleta-opcional-inicio"
const MARCA_COLETA_FIM = "-- @coleta-opcional-fim"

/**
 * Remove do SQL o bloco que lê `coleta_log_ultima`.
 *
 * Existe porque a guarda não cabe dentro do próprio SELECT: a relação é
 * resolvida na análise do comando, então `to_regclass` em tempo de execução
 * chegaria tarde e a consulta inteira falharia em banco sem a migration. O
 * relatório precisa continuar saindo ali (banco novo, rollback, fork), com a
 * procedência marcada como não lida em vez de nada.
 *
 * Marcador ausente é erro e não silêncio: significa que alguém renomeou os
 * delimitadores no `.sql` e que a degradação parou de funcionar sem avisar.
 */
export function removerBlocoDeColeta(sql: string): string {
  const inicio = sql.indexOf(MARCA_COLETA_INICIO)
  const fim = sql.indexOf(MARCA_COLETA_FIM)
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error(
      `coverage-snapshot.sql sem os marcadores ${MARCA_COLETA_INICIO}/${MARCA_COLETA_FIM}: ` +
        "o bloco de coleta não pode mais ser removido em banco sem a migration coleta_log"
    )
  }
  return sql.slice(0, inicio) + sql.slice(fim + MARCA_COLETA_FIM.length)
}

/**
 * Roda `coverage-snapshot.sql` e devolve o array que o relatório consome.
 * O SQL devolve uma linha e uma coluna (`snapshot`) com o array inteiro.
 *
 * O campo `coleta` de cada candidato sai daqui junto com o resto, numa consulta
 * só. Em banco sem `coleta_log_ultima` o bloco é removido antes do envio.
 */
export async function obterSnapshot(
  caminhoSql: string,
  opcoes: { ref?: string; token?: string } = {}
): Promise<unknown[]> {
  const ref = opcoes.ref || process.env.SUPABASE_PROJECT_REF || PROJECT_REF_PADRAO
  const token = opcoes.token || resolverToken()
  let sql = readFileSync(caminhoSql, "utf8")

  const [{ existe }] = await consultar<{ existe: boolean }>(
    "select to_regclass('public.coleta_log_ultima') is not null as existe",
    ref,
    token
  )
  if (!existe) {
    console.error(
      "[cobertura] coleta_log_ultima não existe neste banco; " +
        "o snapshot sai sem procedência e todo zero fica como não lido"
    )
    sql = removerBlocoDeColeta(sql)
  }

  const linhas = await consultar<{ snapshot: unknown[] | null }>(sql, ref, token)
  const snapshot = linhas[0]?.snapshot
  if (!Array.isArray(snapshot)) {
    throw new Error(
      `coverage-snapshot.sql não devolveu a coluna 'snapshot' esperada (recebido: ${JSON.stringify(
        linhas
      ).slice(0, 200)})`
    )
  }
  return snapshot
}

