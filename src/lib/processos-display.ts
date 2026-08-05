/**
 * Display honesto do contador de processos judiciais (2026-08-05).
 *
 * Processos não têm ingest: as linhas existentes vêm de verificação manual em
 * parte dos candidatos (critério em docs/criterio-processos-judiciais.md), e
 * não existe base pública que permita busca por pessoa. Um "0" no card de
 * overview afirmava ficha limpa para quem ninguém verificou. Zero sem
 * verificação vira "—" com a legenda "não verificado"; contagem positiva
 * continua numérica, com o destaque criminal existente.
 */
export interface ProcessosOverviewDisplay {
  value: string | number
  sub?: string
}

export function processosOverviewDisplay(
  total: number | null | undefined,
  criminais?: number | null,
): ProcessosOverviewDisplay {
  const n = total ?? 0
  if (n > 0) {
    return {
      value: n,
      sub: (criminais ?? 0) > 0 ? `${criminais} criminal` : undefined,
    }
  }
  return { value: "—", sub: "não verificado" }
}

export function processosNaoVerificado(total: number | null | undefined): boolean {
  return typeof processosOverviewDisplay(total).value !== "number"
}

export function processosResumoLabel(total: number | null | undefined): string {
  if (processosNaoVerificado(total)) return "processos não verificados"
  return total === 1 ? "1 processo" : `${total} processos`
}

/**
 * Decide o selo "maior" pela mesma régua usada para exibir processos.
 * Se algum selecionado não tiver uma contagem verificada, não há comparação
 * honesta possível e nenhum candidato recebe o selo.
 */
export function processosMaiorVerificadoNaComparacao(
  total: number | null | undefined,
  totaisSelecionados: Array<number | null | undefined>,
): boolean {
  const displays = totaisSelecionados.map((item) => processosOverviewDisplay(item))
  if (displays.some((display) => typeof display.value !== "number")) return false

  const totalDisplay = processosOverviewDisplay(total)
  if (typeof totalDisplay.value !== "number") return false

  const valores = displays.map((display) => display.value as number)
  const max = Math.max(...valores)
  const todosIguais = valores.every((valor) => valor === max)

  return totalDisplay.value === max && totalDisplay.value > 0 && !todosIguais
}
