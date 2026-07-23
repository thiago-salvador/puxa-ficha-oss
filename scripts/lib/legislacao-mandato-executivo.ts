/**
 * Helper para normalizar e validar linhas candidatas de legislacao_mandato_executivo
 * antes de qualquer upsert. Independente de Supabase e sem rede.
 */

export type LegislacaoMandatoExecutivoTipoRelacao =
  | "projeto_enviado_pelo_executivo"
  | "lei_sancionada"
  | "lei_promulgada_pelo_legislativo"

export type LegislacaoMandatoExecutivoEsfera = "federal" | "estadual" | "municipal"

export type LegislacaoMandatoExecutivoAutoridadePapel =
  | "titular"
  | "vice_interino"
  | "mesa_legislativa"
  | "outro"
  | "nao_informado"

export interface LegislacaoMandatoExecutivoInput {
  candidato_id: string
  historico_politico_id?: string | null
  tipo_relacao: string
  esfera: string
  uf_norma?: string | null
  municipio_norma?: string | null
  tipo_norma?: string | null
  numero?: string | null
  ano?: number | null
  data_norma?: string | null
  ementa?: string | null
  signatario?: string | null
  autoridade_papel?: string
  fonte_primaria_url: string
  fonte_primaria_titulo?: string | null
  fonte_tramitacao_url?: string | null
  identificador_fonte?: string | null
  metadata?: Record<string, unknown> | null
}

export interface LegislacaoMandatoExecutivoRow {
  candidato_id: string
  historico_politico_id: string | null
  tipo_relacao: LegislacaoMandatoExecutivoTipoRelacao
  esfera: LegislacaoMandatoExecutivoEsfera
  uf_norma: string | null
  municipio_norma: string | null
  tipo_norma: string | null
  numero: string | null
  ano: number | null
  data_norma: string | null
  ementa: string | null
  signatario: string | null
  autoridade_papel: LegislacaoMandatoExecutivoAutoridadePapel
  fonte_primaria_url: string
  fonte_primaria_titulo: string | null
  fonte_tramitacao_url: string | null
  identificador_fonte: string | null
  metadata: Record<string, unknown>
}

export interface NormalizeError {
  field: string
  message: string
}

export interface NormalizeResult {
  success: true
  row: LegislacaoMandatoExecutivoRow
}

export interface NormalizeFailure {
  success: false
  errors: NormalizeError[]
}

export type NormalizeLegislacaoMandatoExecutivo = NormalizeResult | NormalizeFailure

const VALID_TIPO_RELACAO: Set<string> = new Set([
  "projeto_enviado_pelo_executivo",
  "lei_sancionada",
  "lei_promulgada_pelo_legislativo",
])

const VALID_ESFERA: Set<string> = new Set(["federal", "estadual", "municipal"])

const VALID_AUTORIDADE_PAPEL: Set<string> = new Set([
  "titular",
  "vice_interino",
  "mesa_legislativa",
  "outro",
  "nao_informado",
])

const UF_REGEX = /^[A-Z]{2}$/

type NormalizedScope = {
  esfera: LegislacaoMandatoExecutivoEsfera
  uf_norma: string | null
  municipio_norma: string | null
}

function pushAllowedValueError(errors: NormalizeError[], field: string, allowed: Set<string>) {
  errors.push({
    field,
    message: `${field} must be one of: ${Array.from(allowed).join(", ")}`,
  })
}

function normalizeUfNorma(input: LegislacaoMandatoExecutivoInput): string | null {
  if (input.uf_norma == null || input.uf_norma === "") return null
  return input.uf_norma.toUpperCase().trim()
}

function normalizeMunicipioNorma(input: LegislacaoMandatoExecutivoInput): string | null {
  if (input.municipio_norma == null || input.municipio_norma === "") return null
  const trimmed = input.municipio_norma.trim()
  return trimmed === "" ? null : trimmed
}

function normalizeTipoRelacao(
  input: LegislacaoMandatoExecutivoInput,
  errors: NormalizeError[]
): LegislacaoMandatoExecutivoTipoRelacao {
  if (!VALID_TIPO_RELACAO.has(input.tipo_relacao)) {
    pushAllowedValueError(errors, "tipo_relacao", VALID_TIPO_RELACAO)
  }

  return input.tipo_relacao as LegislacaoMandatoExecutivoTipoRelacao
}

function normalizeEsfera(
  input: LegislacaoMandatoExecutivoInput,
  errors: NormalizeError[]
): LegislacaoMandatoExecutivoEsfera {
  if (!VALID_ESFERA.has(input.esfera)) {
    pushAllowedValueError(errors, "esfera", VALID_ESFERA)
  }

  return input.esfera as LegislacaoMandatoExecutivoEsfera
}

function validateUfNorma(
  errors: NormalizeError[],
  uf_norma: string | null,
  fieldExample: string
) {
  if (uf_norma === null) {
    errors.push({
      field: "uf_norma",
      message: `uf_norma is required for ${fieldExample} esfera`,
    })
  } else if (!UF_REGEX.test(uf_norma)) {
    errors.push({
      field: "uf_norma",
      message: `uf_norma must match ${UF_REGEX.source} (e.g., "SP", "RJ")`,
    })
  }
}

function normalizeScope(
  input: LegislacaoMandatoExecutivoInput,
  errors: NormalizeError[]
): NormalizedScope {
  const esfera = normalizeEsfera(input, errors)
  const uf_norma = normalizeUfNorma(input)
  const municipio_norma = normalizeMunicipioNorma(input)

  if (esfera === "federal") {
    if (uf_norma !== null) {
      errors.push({ field: "uf_norma", message: "uf_norma must be null for federal esfera" })
    }
    if (municipio_norma !== null) {
      errors.push({
        field: "municipio_norma",
        message: "municipio_norma must be null for federal esfera",
      })
    }
  } else if (esfera === "estadual") {
    validateUfNorma(errors, uf_norma, "estadual")
    if (municipio_norma !== null) {
      errors.push({
        field: "municipio_norma",
        message: "municipio_norma must be null for estadual esfera",
      })
    }
  } else if (esfera === "municipal") {
    validateUfNorma(errors, uf_norma, "municipal")
    if (municipio_norma === null) {
      errors.push({
        field: "municipio_norma",
        message: "municipio_norma is required and cannot be empty for municipal esfera",
      })
    }
  }

  return { esfera, uf_norma, municipio_norma }
}

function normalizeFontePrimariaUrl(
  input: LegislacaoMandatoExecutivoInput,
  errors: NormalizeError[]
): string {
  const raw = input.fonte_primaria_url
  if (!raw || raw.trim() === "") {
    errors.push({
      field: "fonte_primaria_url",
      message: "fonte_primaria_url is required and cannot be empty",
    })
    return ""
  }

  return raw.trim()
}

function normalizeAutoridadePapel(
  input: LegislacaoMandatoExecutivoInput,
  errors: NormalizeError[]
): LegislacaoMandatoExecutivoAutoridadePapel {
  const rawAutoridadePapel = input.autoridade_papel ?? "nao_informado"
  if (!VALID_AUTORIDADE_PAPEL.has(rawAutoridadePapel)) {
    pushAllowedValueError(errors, "autoridade_papel", VALID_AUTORIDADE_PAPEL)
  }

  return rawAutoridadePapel as LegislacaoMandatoExecutivoAutoridadePapel
}

function validateRelacaoConstraints(
  input: LegislacaoMandatoExecutivoInput,
  tipo_relacao: LegislacaoMandatoExecutivoTipoRelacao,
  autoridade_papel: LegislacaoMandatoExecutivoAutoridadePapel,
  errors: NormalizeError[]
) {
  if (tipo_relacao === "lei_sancionada") {
    if (!input.data_norma) {
      errors.push({ field: "data_norma", message: "data_norma is required for lei_sancionada" })
    }

    if (!input.signatario || input.signatario.trim() === "") {
      errors.push({
        field: "signatario",
        message: "signatario is required and cannot be empty for lei_sancionada",
      })
    }

    if (!["titular", "vice_interino", "outro"].includes(autoridade_papel)) {
      errors.push({
        field: "autoridade_papel",
        message: "autoridade_papel must be titular, vice_interino, or outro for lei_sancionada",
      })
    }
  }

  if (
    tipo_relacao === "lei_promulgada_pelo_legislativo" &&
    autoridade_papel !== "mesa_legislativa"
  ) {
    errors.push({
      field: "autoridade_papel",
      message: "autoridade_papel must be mesa_legislativa for lei_promulgada_pelo_legislativo",
    })
  }
}

function buildLegislacaoMandatoExecutivoRow(
  input: LegislacaoMandatoExecutivoInput,
  tipo_relacao: LegislacaoMandatoExecutivoTipoRelacao,
  scope: NormalizedScope,
  autoridade_papel: LegislacaoMandatoExecutivoAutoridadePapel,
  fonte_primaria_url: string
): LegislacaoMandatoExecutivoRow {
  return {
    candidato_id: input.candidato_id,
    historico_politico_id: input.historico_politico_id ?? null,
    tipo_relacao,
    esfera: scope.esfera,
    uf_norma: scope.uf_norma,
    municipio_norma: scope.municipio_norma,
    tipo_norma: input.tipo_norma ?? null,
    numero: input.numero ?? null,
    ano: input.ano ?? null,
    data_norma: input.data_norma ?? null,
    ementa: input.ementa ?? null,
    signatario: input.signatario ?? null,
    autoridade_papel,
    fonte_primaria_url,
    fonte_primaria_titulo: input.fonte_primaria_titulo ?? null,
    fonte_tramitacao_url: input.fonte_tramitacao_url ?? null,
    identificador_fonte: input.identificador_fonte ?? null,
    metadata: input.metadata ?? {},
  }
}

/**
 * Normaliza e valida uma linha candidata de legislacao_mandato_executivo.
 * Retorna objeto pronto para insert/upsert ou erro estruturado.
 */
export function normalizeLegislacaoMandatoExecutivo(
  input: LegislacaoMandatoExecutivoInput
): NormalizeLegislacaoMandatoExecutivo {
  const errors: NormalizeError[] = []
  const tipo_relacao = normalizeTipoRelacao(input, errors)
  const scope = normalizeScope(input, errors)
  const fonte_primaria_url = normalizeFontePrimariaUrl(input, errors)
  const autoridade_papel = normalizeAutoridadePapel(input, errors)
  validateRelacaoConstraints(input, tipo_relacao, autoridade_papel, errors)

  if (errors.length > 0) {
    return { success: false, errors }
  }

  const row = buildLegislacaoMandatoExecutivoRow(
    input,
    tipo_relacao,
    scope,
    autoridade_papel,
    fonte_primaria_url
  )

  return { success: true, row }
}
