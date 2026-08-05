export interface CandidatoConfig {
  slug: string
  nome_completo: string
  nome_urna: string
  cargo_disputado:
    | "Presidente"
    | "Governador"
    | "Vice-Governador"
    | "Senador"
    | "Deputado Federal"
    | "Nenhum"
  estado?: string
  wikipedia_title?: string
  ids: {
    camara: number | null
    senado: number | null
    tse_sq_candidato: Record<string, string>
  }
}

export interface IngestResult {
  source: string
  candidato: string
  tables_updated: string[]
  rows_upserted: number
  errors: string[]
  duration_ms: number
  /** Quando true, nenhuma escrita foi feita (ex.: ingest opcional que pula candidato ja coberto). */
  skipped?: boolean
  skip_reason?: string
  /** Em ingest incremental Camara: etapas que foram puladas por ja estarem cobertas no banco. */
  incremental_skipped?: ("perfil" | "gastos_parlamentares" | "votos_candidato" | "projetos_lei")[]

  /**
   * Desfecho de coleta declarado pelo proprio ingest, gravado em `coleta_log`.
   *
   * Quando ausente, `entradaDeResultado` (scripts/lib/coleta-log.ts) infere: erro
   * se houve erro, encontrado se houve escrita, e `indeterminado` no resto. O
   * campo existe porque a inferencia NAO consegue distinguir "a fonte respondeu
   * vazio" de "a consulta falhou e o codigo engoliu a falha", e so o ingest sabe.
   * Declarar `vazio_confirmado` aqui e a unica forma de afirmar que um zero e
   * real. Ver o comentario da migration 20260804160000.
   */
  coleta_resultado?: "encontrado" | "vazio_confirmado" | "nao_aplicavel" | "erro" | "indeterminado"
  coleta_detalhe?: string
}
