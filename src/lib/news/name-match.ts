/**
 * Verificacao pos-fetch de que a noticia devolvida pelo Google News realmente
 * cita o candidato a quem ela vai ser associada.
 *
 * Motivo (auditoria de integridade 2026-07-24, etapa 1C): a associacao
 * noticia-candidato era 100% delegada ao ranking de busca do Google. O
 * pipeline montava a query com o nome entre aspas, pegava os 20 primeiros
 * itens e gravava, sem nunca comparar o titulo devolvido com o nome do
 * candidato. Resultado medido em 17.498 linhas de `noticias_candidato`:
 * 3.984 (22,77%) sem nenhum token do nome de urna no titulo, com candidatos
 * inteiros entre 82% e 97% de ruido (maria-da-consolacao 97,3%,
 * enilton-rodrigues 87,7%, caiubi-kuhn 86,9%, cintia-dias 82,9%).
 *
 * O criterio aqui e deliberadamente FROUXO, na direcao segura: so reprova
 * quando o titulo nao traz NENHUMA variacao do nome. Um sobrenome comum que
 * aparece por acaso continua passando. Preferimos manter uma noticia duvidosa
 * a jogar fora cobertura legitima.
 *
 * O caso "JHC" (Joao Henrique Caldas, governador de AL) e tratado
 * explicitamente: o corte de 4 letras usado na auditoria marcava 117 de 117
 * noticias dele como sem match, o que era artefato do corte, nao erro de
 * dado. Sigla curta e casada como palavra inteira.
 *
 * Modulo puro: sem import de next/*, server-only, fs, rede ou Supabase, para
 * rodar identico no script tsx (`scripts/lib/ingest-google-news.ts`) e dentro
 * da function da Vercel (`src/lib/news/refresh.ts`).
 */

/** Conectivos de nome proprio em pt-BR: nunca contam como mencao. */
const PARTICULAS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "di",
  "del",
  "della",
  "van",
  "von",
  "la",
  "le",
])

/** Comprimento minimo para um token de nome contar sozinho como mencao. */
const TOKEN_DISTINTIVO_MIN = 4

/** Comprimento maximo de um nome de urna sem espaco tratado como sigla/apelido curto (JHC, Zema, Lula). */
const SIGLA_CURTA_MAX = 5

function normalizeNewsText(value: string | null | undefined): string {
  if (!value) return ""
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function tokenize(value: string): string[] {
  const normalized = normalizeNewsText(value)
  if (!normalized) return []
  return normalized.split(" ").filter(Boolean)
}

/** Casa `needle` como sequencia de palavras inteiras dentro de `haystack`, ambos ja normalizados. */
function containsWholeWords(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false
  return ` ${haystack} `.includes(` ${needle} `)
}

export interface CandidateNameInput {
  nome_urna?: string | null
  nome_completo?: string | null
  /** Apelidos extras conhecidos (curadoria). Opcional. */
  apelidos?: readonly (string | null | undefined)[] | null
}

/**
 * `true` quando o titulo traz alguma variacao do nome do candidato.
 *
 * Ordem das regras, da mais forte para a mais fraca:
 *  1. nome de urna inteiro como sequencia de palavras;
 *  2. nome completo inteiro como sequencia de palavras;
 *  3. qualquer apelido curado inteiro;
 *  4. sigla ou apelido curto (nome de urna sem espaco, ate 5 letras) como palavra inteira;
 *  5. qualquer token distintivo (>= 4 letras, fora das particulas) do nome de urna
 *     ou do nome completo, como palavra inteira.
 */
export function newsTitleMentionsCandidate(
  titulo: string | null | undefined,
  candidato: CandidateNameInput,
): boolean {
  const title = normalizeNewsText(titulo)
  if (!title) return false

  const nomeUrna = normalizeNewsText(candidato.nome_urna)
  const nomeCompleto = normalizeNewsText(candidato.nome_completo)

  if (nomeUrna && containsWholeWords(title, nomeUrna)) return true
  if (nomeCompleto && containsWholeWords(title, nomeCompleto)) return true

  for (const apelido of candidato.apelidos ?? []) {
    const normalizado = normalizeNewsText(apelido)
    if (normalizado && containsWholeWords(title, normalizado)) return true
  }

  // Sigla/apelido curto: "JHC", "Zema", "Lula". O corte de 4 letras da
  // auditoria reprovava esses nomes por construcao, nao por ruido real.
  const urnaTokens = tokenize(nomeUrna)
  if (urnaTokens.length === 1 && urnaTokens[0].length <= SIGLA_CURTA_MAX) {
    return containsWholeWords(title, urnaTokens[0])
  }

  const tokensDistintivos = [...urnaTokens, ...tokenize(nomeCompleto)].filter(
    (token) => token.length >= TOKEN_DISTINTIVO_MIN && !PARTICULAS.has(token),
  )

  return tokensDistintivos.some((token) => containsWholeWords(title, token))
}

export interface NewsRelevanceSplit<T> {
  /** Itens cujo titulo cita o candidato. */
  mencionam: T[]
  /** Itens sem nenhuma mencao ao nome: cobertura do pleito, nao do candidato. */
  contextoDoPleito: T[]
}

/**
 * Separa uma lista de noticias entre as que citam o candidato e as que nao
 * citam. Quem consome decide o que fazer com o segundo grupo: a ingestao
 * descarta, a leitura rotula.
 */
export function splitNewsByCandidateMention<T extends { titulo?: string | null }>(
  items: readonly T[],
  candidato: CandidateNameInput,
): NewsRelevanceSplit<T> {
  const mencionam: T[] = []
  const contextoDoPleito: T[] = []

  for (const item of items) {
    if (newsTitleMentionsCandidate(item.titulo, candidato)) {
      mencionam.push(item)
    } else {
      contextoDoPleito.push(item)
    }
  }

  return { mencionam, contextoDoPleito }
}
