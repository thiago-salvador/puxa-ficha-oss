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
