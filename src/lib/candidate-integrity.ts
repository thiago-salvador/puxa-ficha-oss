import type { MudancaPartido } from "@/lib/types"
import { partiesHistoricallyEquivalent } from "@/lib/party-utils"

function normalizePartyValue(value: string | null | undefined): string | null {
  if (!value) return null

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
}

export function hasIncompletePartyTimeline(
  mudancas: MudancaPartido[],
  partidoSigla: string | null | undefined,
  partidoAtual: string | null | undefined
): boolean {
  if (mudancas.length === 0) return false

  const latest = [...mudancas].sort((a, b) => b.ano - a.ano)[0]
  const latestPartidoNovo = latest?.partido_novo ?? null
  const latestToken = normalizePartyValue(latestPartidoNovo)

  if (!latestToken) return false

  const currentTokens = [normalizePartyValue(partidoSigla), normalizePartyValue(partidoAtual)].filter(
    (value): value is string => Boolean(value)
  )

  if (currentTokens.length === 0) return false

  if (currentTokens.includes(latestToken)) return false

  // Equivalência histórica (ex.: PMDB ↔ MDB, DEM ↔ UNIÃO) evita falso positivo quando o
  // normalizador da timeline colapsa a row de rename como redundante e a última entrada
  // ativa fica no partido pré-rename, apesar de o candidato estar no partido canônico atual.
  if (partidoSigla && partiesHistoricallyEquivalent(latestPartidoNovo, partidoSigla)) return false
  if (partidoAtual && partiesHistoricallyEquivalent(latestPartidoNovo, partidoAtual)) return false

  return true
}
