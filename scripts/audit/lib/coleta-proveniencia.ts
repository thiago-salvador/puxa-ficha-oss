/**
 * Procedência de célula do relatório de cobertura (2026-08-04).
 *
 * O `coverage-model.ts` documenta, no próprio cabeçalho, a limitação que este
 * arquivo remove: o estado `zero` significa "zero legítimo ou não coletado; o
 * banco não distingue os dois", e são 954 células nesse estado. Com
 * `public.coleta_log` gravando a TENTATIVA, e não só o resultado, dá para
 * separar as duas coisas.
 *
 * Este módulo é puro: recebe o que o snapshot já traz e devolve o veredito. Não
 * toca banco, não escreve nada, e de propósito NÃO altera `calcularCelulas`. A
 * régua de cobertura tem dono, e a integração na tabela é da thread que mexe no
 * relatório; aqui fica só o cálculo, pronto para ser chamado.
 *
 * Como usar, do lado do relatório:
 *
 *   const p = provenienciaDaColuna("sancoes", candidato.coleta)
 *   if (celula.state === "zero" && p.veredito === "nunca_verificado") {
 *     // pintar diferente de um zero provado, e listar as fontes que faltam
 *   }
 */

/** O que `coleta_log` registrou para a última tentativa de uma fonte. */
export interface UltimaColeta {
  resultado: "encontrado" | "vazio_confirmado" | "nao_aplicavel" | "erro" | "indeterminado"
  volume?: number
  executado_em?: string
  detalhe?: string | null
}

/** Mapa fonte -> última tentativa, como o snapshot entrega (chave `coleta`). */
export type ColetaPorFonte = Record<string, UltimaColeta>

export type VeredictoProveniencia =
  /** Alguma fonte trouxe dado. O vazio da célula, se houver, é de outro recorte. */
  | "coletado"
  /** Todas as fontes responderam, e responderam vazio. É o único zero que se pode afirmar. */
  | "zero_provado"
  /** Pelo menos uma fonte nunca foi tentada para este candidato. */
  | "nunca_verificado"
  /** Todas foram tentadas, mas alguma falhou ou não soube dizer. */
  | "nao_sabemos"
  /** A coluna não é alimentada por ingest nenhum: o preenchimento é curadoria. */
  | "sem_ingest"

export interface Proveniencia {
  veredito: VeredictoProveniencia
  /** Fontes que a coluna depende e que nunca foram tentadas. */
  faltando: string[]
  /** Fontes tentadas cujo desfecho foi erro ou indeterminado. */
  duvidosas: string[]
}

/**
 * Quais fontes de ingestão alimentam cada coluna do relatório.
 *
 * As chaves são as de `COLUNAS` em `coverage-model.ts`; os valores são os
 * `source` que os ingests declaram, os mesmos de `FONTES` em
 * `scripts/lib/coleta-log.ts`.
 *
 * Lista VAZIA é afirmação, não omissão: quer dizer que nenhum ingest preenche
 * aquela coluna e que o dado só entra por curadoria (é o caso de processos
 * judiciais, cujas 30 linhas vieram de STF, MP-RJ e veículos de imprensa, uma a
 * uma). Nessas colunas, cobrar coleta automatizada seria cobrar o que não
 * existe, e o vazio se resolve com trabalho editorial.
 */
export const FONTES_POR_COLUNA: Readonly<Record<string, readonly string[]>> = Object.freeze({
  foto: ["wikipedia"],
  bio: ["wikipedia"],
  redes: ["wikipedia", "instagram"],
  dados: ["tse-situacao", "wikidata"],
  cargos: ["tse-historico", "wikidata-politico"],
  partidos: ["tse-historico", "filiacao", "wikidata-politico"],

  patrimonio: ["tse"],
  evolucao: ["tse"],
  bens: ["tse"],
  financiamento: ["tse"],
  doadores: ["tse"],

  votos: ["camara", "senado"],
  projetos: ["camara", "senado"],
  destaques: ["camara", "senado"],
  gastos: ["camara", "ceaps-senado"],

  noticias: ["google-news"],
  sancoes: ["transparencia-sanctions"],

  // Curadoria: nenhum ingest escreve, então não há coleta a cobrar.
  processos: [],
  posicoes: [],
  legexec: [],
  // Derivadas de outras colunas, não de fonte externa.
  contradicoes: [],
  alertas: [],
  revisar: [],
})

/**
 * Veredito para uma coluna, dada a última tentativa de cada fonte.
 *
 * A ordem de precedência é a parte que carrega a opinião, e ela é deliberada:
 *
 *   1. `nunca_verificado` ganha de tudo que não seja dado na mão. Fonte que
 *      ninguém tentou é trabalho pendente com endereço, e é o que o dono do
 *      projeto precisa ver primeiro. Esconder isso atrás de "houve um erro" faz
 *      parecer que já foram lá e não deu.
 *   2. `nao_sabemos` vem depois: foi tentado, e a resposta não permite concluir.
 *   3. `zero_provado` é o mais raro e o mais valioso, e exige que TODAS as
 *      fontes tenham respondido. Basta uma sem resposta para não valer.
 *
 * `coletado` sai na frente porque, se alguma fonte trouxe dado, o vazio da
 * célula não é falta de coleta e sim recorte da régua (uma cota parlamentar
 * antiga demais para a janela, por exemplo).
 */
export function provenienciaDaColuna(coluna: string, coleta: ColetaPorFonte = {}): Proveniencia {
  const fontes = FONTES_POR_COLUNA[coluna]

  if (!fontes) {
    // Coluna que não está no mapa é bug de manutenção, não silêncio: devolver
    // "não sabemos" evita que uma coluna nova apareça como zero provado.
    return { veredito: "nao_sabemos", faltando: [], duvidosas: [] }
  }

  if (fontes.length === 0) {
    return { veredito: "sem_ingest", faltando: [], duvidosas: [] }
  }

  const faltando: string[] = []
  const duvidosas: string[] = []
  let algumEncontrou = false

  for (const fonte of fontes) {
    const ultima = coleta[fonte]
    if (!ultima) {
      faltando.push(fonte)
      continue
    }
    if (ultima.resultado === "encontrado") algumEncontrou = true
    else if (ultima.resultado === "erro" || ultima.resultado === "indeterminado") {
      duvidosas.push(fonte)
    }
  }

  if (algumEncontrou) return { veredito: "coletado", faltando, duvidosas }
  if (faltando.length > 0) return { veredito: "nunca_verificado", faltando, duvidosas }
  if (duvidosas.length > 0) return { veredito: "nao_sabemos", faltando, duvidosas }
  return { veredito: "zero_provado", faltando, duvidosas }
}

/** Rótulo curto para a interface, no mesmo tom das outras legendas do relatório. */
export const ROTULO_PROVENIENCIA: Readonly<Record<VeredictoProveniencia, string>> = Object.freeze({
  coletado: "coletado",
  zero_provado: "verificado, não há",
  nunca_verificado: "nunca verificado",
  nao_sabemos: "tentado, sem resposta",
  sem_ingest: "só por curadoria",
})
