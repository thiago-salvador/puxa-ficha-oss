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

/**
 * Roda `coverage-snapshot.sql` e devolve o array que o relatório consome.
 * O SQL devolve uma linha e uma coluna (`snapshot`) com o array inteiro.
 */
export async function obterSnapshot(
  caminhoSql: string,
  opcoes: { ref?: string; token?: string } = {}
): Promise<unknown[]> {
  const ref = opcoes.ref || process.env.SUPABASE_PROJECT_REF || PROJECT_REF_PADRAO
  const token = opcoes.token || resolverToken()
  const sql = readFileSync(caminhoSql, "utf8")

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

/**
 * Última tentativa de coleta por candidato e por fonte, quando o banco já tem
 * `coleta_log` (migration `coleta_log_tentativa_por_fonte`).
 *
 * Devolve `null` quando a tabela ainda não existe. É de propósito: um relatório
 * que quebrasse por causa de uma tabela ausente obrigaria as duas frentes a
 * mergear no mesmo dia, e o relatório sabe representar a falta (a procedência
 * de todo zero vira `desconhecida` e a legenda diz isso).
 */
export async function obterColetas(
  caminhoSql: string,
  opcoes: { ref?: string; token?: string } = {}
): Promise<Record<string, Record<string, string>> | null> {
  const ref = opcoes.ref || process.env.SUPABASE_PROJECT_REF || PROJECT_REF_PADRAO
  const token = opcoes.token || resolverToken()

  const [{ existe }] = await consultar<{ existe: boolean }>(
    "select to_regclass('public.coleta_log_ultima') is not null as existe",
    ref,
    token
  )
  if (!existe) return null

  const linhas = await consultar<{ coletas: Record<string, Record<string, string>> }>(
    readFileSync(caminhoSql, "utf8"),
    ref,
    token
  )
  return linhas[0]?.coletas ?? {}
}
