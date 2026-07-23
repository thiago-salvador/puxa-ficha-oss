export interface QuizVotacaoRow {
  id: string | null
  titulo: string | null
  casa: string | null
  proposicao_id: string | null
}

export type QuizVotacaoException =
  | string
  | {
      titulo?: unknown
      motivo?: unknown
      reason?: unknown
    }

export interface QuizVotacoesExceptionsFile {
  exceptions?: QuizVotacaoException[]
}

export interface QuizVotacoesContractResult {
  ok: boolean
  errors: string[]
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function formatRowRef(row: QuizVotacaoRow): string {
  const id = clean(row.id) || "sem-id"
  const casa = clean(row.casa) || "sem-casa"
  const proposicaoId = clean(row.proposicao_id) || "sem-proposicao_id"
  return `${id}/${casa}/${proposicaoId}`
}

function extractQuizVotacaoExceptionTitles(
  input: QuizVotacoesExceptionsFile | null | undefined,
): { titles: Set<string>; errors: string[] } {
  const titles = new Set<string>()
  const errors: string[] = []
  const exceptions = input?.exceptions ?? []

  if (!Array.isArray(exceptions)) {
    return {
      titles,
      errors: ["quiz-votacoes exceptions deve ser array"],
    }
  }

  for (const [index, item] of exceptions.entries()) {
    const title = typeof item === "string" ? item : clean(item.titulo)
    if (!title) {
      errors.push(`excecao #${index + 1} sem titulo`)
      continue
    }
    if (titles.has(title)) {
      errors.push(`excecao duplicada para titulo "${title}"`)
      continue
    }
    titles.add(title)
  }

  return { titles, errors }
}

export function validateQuizVotacoesContract(
  quizTitulos: readonly string[],
  rows: readonly QuizVotacaoRow[],
  exceptionsFile?: QuizVotacoesExceptionsFile | null,
): QuizVotacoesContractResult {
  const errors: string[] = []
  const expected = quizTitulos.map(clean).filter(Boolean)
  const expectedSet = new Set<string>()
  const duplicateExpected = new Set<string>()

  for (const title of expected) {
    if (expectedSet.has(title)) duplicateExpected.add(title)
    expectedSet.add(title)
  }

  for (const title of duplicateExpected) {
    errors.push(`votacao_titulo duplicado no quiz: "${title}"`)
  }

  const exceptionState = extractQuizVotacaoExceptionTitles(exceptionsFile)
  errors.push(...exceptionState.errors)

  for (const title of exceptionState.titles) {
    if (!expectedSet.has(title)) {
      errors.push(`excecao referencia titulo fora do quiz: "${title}"`)
    }
  }

  const rowsByTitle = new Map<string, QuizVotacaoRow[]>()
  for (const row of rows) {
    const title = clean(row.titulo)
    if (!title || !expectedSet.has(title)) continue
    const list = rowsByTitle.get(title) ?? []
    list.push(row)
    rowsByTitle.set(title, list)
  }

  for (const title of expectedSet) {
    const matches = rowsByTitle.get(title) ?? []
    if (matches.length === 0) {
      errors.push(`votacao_titulo sem linha em votacoes_chave: "${title}"`)
      continue
    }
    if (matches.length > 1) {
      errors.push(
        `votacao_titulo ambiguo em votacoes_chave: "${title}" (${matches.map(formatRowRef).join(", ")})`,
      )
      continue
    }

    const row = matches[0]
    if (!clean(row.casa)) {
      errors.push(`votacao_titulo sem casa em votacoes_chave: "${title}" (${formatRowRef(row)})`)
    }
    if (!clean(row.proposicao_id) && !exceptionState.titles.has(title)) {
      errors.push(
        `votacao_titulo sem proposicao_id e sem excecao operacional: "${title}" (${formatRowRef(row)})`,
      )
    }
  }

  return { ok: errors.length === 0, errors }
}
