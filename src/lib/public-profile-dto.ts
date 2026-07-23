import type {
  FichaCandidato,
  Financiamento,
  HistoricoPolitico,
  LegislacaoMandatoExecutivo,
  MudancaPartido,
  Patrimonio,
  Processo,
  ProjetoLei,
  PontoAtencao,
  SancaoAdministrativa,
  VotoCandidato,
} from "@/lib/types"

const DOCUMENT_LIKE_SEQUENCE_RE =
  /(^|[^\d])((?:\d{3}\.?\d{3}\.?\d{3}-?\d{2})|(?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})|\d{11}|\d{14})(?=$|[^\d])/g

const FORBIDDEN_PUBLIC_PROFILE_KEY_RE =
  /(?:cpf|cnpj|documento|email|telefone|token|secret)/i

export function maskDocumentLikeSequences(value: string | null | undefined): string {
  return (value ?? "").replace(
    DOCUMENT_LIKE_SEQUENCE_RE,
    (_match, prefix: string) => `${prefix}[documento mascarado]`
  )
}

function maskNullableText(value: string | null | undefined): string | null {
  if (value == null) return null
  return maskDocumentLikeSequences(value)
}

function hashPublicId(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function compactPublicId(prefix: string, source: string | null | undefined, index: number) {
  return `${prefix}-${index + 1}-${hashPublicId(source ?? `${prefix}-${index}`)}`
}

function publicHistorico(row: HistoricoPolitico, index: number) {
  return {
    id: compactPublicId("hist", row.id, index),
    cargo: row.cargo,
    cargo_canonico: row.cargo_canonico ?? null,
    tipo_evento: row.tipo_evento ?? null,
    periodo_inicio: row.periodo_inicio,
    periodo_fim: row.periodo_fim,
    partido: row.partido,
    estado: row.estado,
    eleito_por: row.eleito_por,
    observacoes: maskNullableText(row.observacoes),
    proveniencia: row.proveniencia ?? null,
  }
}

function publicMudancaPartido(row: MudancaPartido, index: number) {
  return {
    id: compactPublicId("mud", row.id, index),
    partido_anterior: row.partido_anterior,
    partido_novo: row.partido_novo,
    data_mudanca: row.data_mudanca,
    ano: row.ano,
    contexto: maskNullableText(row.contexto),
  }
}

function publicPatrimonio(row: Patrimonio, index: number) {
  return {
    id: compactPublicId("pat", row.id, index),
    ano_eleicao: row.ano_eleicao,
    valor_total: row.valor_total,
    bens: (row.bens ?? []).map((bem) => ({
      tipo: bem.tipo,
      descricao: maskDocumentLikeSequences(bem.descricao),
      valor: bem.valor,
    })),
  }
}

function publicFinanciamento(row: Financiamento, index: number) {
  return {
    id: compactPublicId("fin", row.id, index),
    ano_eleicao: row.ano_eleicao,
    total_arrecadado: row.total_arrecadado,
    total_fundo_partidario: row.total_fundo_partidario,
    total_fundo_eleitoral: row.total_fundo_eleitoral,
    total_pessoa_fisica: row.total_pessoa_fisica,
    total_recursos_proprios: row.total_recursos_proprios,
    maiores_doadores: (row.maiores_doadores ?? []).map((doador) => ({
      nome: doador.nome,
      valor: doador.valor,
      tipo: doador.tipo,
    })),
  }
}

function publicVoto(row: VotoCandidato, index: number) {
  return {
    id: compactPublicId("voto", row.id, index),
    votacao_id: row.votacao_id,
    voto: row.voto,
    contradicao: row.contradicao,
    contradicao_descricao: maskNullableText(row.contradicao_descricao),
    votacao: row.votacao
      ? {
          id: compactPublicId("votacao", row.votacao.id, index),
          titulo: row.votacao.titulo,
          descricao: maskDocumentLikeSequences(row.votacao.descricao),
          data_votacao: row.votacao.data_votacao,
          casa: row.votacao.casa,
          tema: row.votacao.tema,
          impacto_popular: row.votacao.impacto_popular,
          proposicao_id: row.votacao.proposicao_id ?? null,
        }
      : undefined,
  }
}

function publicProcesso(row: Processo, index: number) {
  return {
    id: compactPublicId("proc", row.id, index),
    tipo: row.tipo,
    tribunal: row.tribunal,
    numero_processo: row.numero_processo,
    descricao: maskDocumentLikeSequences(row.descricao),
    status: row.status,
    data_inicio: row.data_inicio,
    data_decisao: row.data_decisao,
    gravidade: row.gravidade,
  }
}

function publicPontoAtencao(row: PontoAtencao, index: number) {
  return {
    id: compactPublicId("ponto", row.id, index),
    categoria: row.categoria,
    titulo: row.titulo,
    descricao: maskDocumentLikeSequences(row.descricao),
    fontes: (row.fontes ?? []).map((fonte) => ({
      titulo: fonte.titulo,
      url: fonte.url,
      data: fonte.data,
    })),
    gravidade: row.gravidade,
    visivel: row.visivel,
    verificado: row.verificado,
    gerado_por: row.gerado_por,
    data_referencia: row.data_referencia ?? null,
  }
}

function publicProjetoLei(row: ProjetoLei, index: number) {
  return {
    id: compactPublicId("pl", row.id, index),
    tipo: row.tipo,
    numero: row.numero,
    ano: row.ano,
    ementa: maskNullableText(row.ementa),
    tema: row.tema,
    situacao: row.situacao,
    url_inteiro_teor: row.url_inteiro_teor,
    destaque: row.destaque,
    destaque_motivo: maskNullableText(row.destaque_motivo),
    coverage_id: row.coverage_id ?? null,
  }
}

function publicLegislacaoMetadata(metadata: Record<string, unknown> | null | undefined) {
  const coverageId = metadata?.coverage_id
  return typeof coverageId === "string" && coverageId.trim()
    ? { coverage_id: coverageId.trim() }
    : {}
}

function publicLegislacaoMandatoExecutivo(row: LegislacaoMandatoExecutivo, index: number) {
  return {
    id: compactPublicId("lme", row.id, index),
    tipo_relacao: row.tipo_relacao,
    tipo_norma: row.tipo_norma,
    numero: row.numero,
    ano: row.ano,
    data_norma: row.data_norma,
    ementa: maskNullableText(row.ementa),
    signatario: row.signatario,
    autoridade_papel: row.autoridade_papel,
    fonte_primaria_url: row.fonte_primaria_url,
    metadata: publicLegislacaoMetadata(row.metadata),
  }
}

function publicGastosParlamentares(row: FichaCandidato["gastos_parlamentares"][number], index: number) {
  return {
    id: compactPublicId("gasto", row.id, index),
    ano: row.ano,
    total_gasto: row.total_gasto,
    detalhamento: (row.detalhamento ?? []).map((item) => ({
      categoria: item.categoria,
      valor: item.valor,
      fornecedor: item.fornecedor ? maskDocumentLikeSequences(item.fornecedor) : undefined,
    })),
    gastos_destaque: (row.gastos_destaque ?? []).map((item) => ({
      descricao: maskDocumentLikeSequences(item.descricao),
      valor: item.valor,
      categoria: item.categoria,
    })),
  }
}

function publicSancao(row: SancaoAdministrativa, index: number) {
  return {
    id: compactPublicId("sancao", row.id, index),
    tipo: row.tipo,
    descricao: maskNullableText(row.descricao),
    orgao_sancionador: row.orgao_sancionador,
    data_inicio: row.data_inicio,
    data_fim: row.data_fim,
    fundamentacao: maskNullableText(row.fundamentacao),
    vinculo: row.vinculo,
  }
}

function publicNoticia(row: FichaCandidato["noticias"][number], index: number) {
  return {
    id: compactPublicId("noticia", row.id, index),
    titulo: row.titulo,
    fonte: row.fonte,
    url: row.url,
    data_publicacao: row.data_publicacao,
    snippet: maskNullableText(row.snippet),
  }
}

function publicIndicador(row: NonNullable<FichaCandidato["indicadores_estaduais"]>[number], index: number) {
  return {
    id: compactPublicId("ind", row.id, index),
    estado: row.estado,
    ano: row.ano,
    fonte: row.fonte,
    indicador: row.indicador,
    valor: row.valor,
    valor_texto: row.valor_texto,
    unidade: row.unidade,
  }
}

function publicSocialLinkValue(value: unknown) {
  if (typeof value === "string") {
    return maskDocumentLikeSequences(value)
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const out: { url?: string; username?: string; followers?: number | null } = {}
  if (typeof record.url === "string") out.url = maskDocumentLikeSequences(record.url)
  if (typeof record.username === "string") out.username = maskDocumentLikeSequences(record.username)
  if (typeof record.followers === "number" || record.followers === null) {
    out.followers = record.followers
  }

  return Object.keys(out).length > 0 ? out : null
}

function publicSocialLinks(value: Record<string, unknown> | null | undefined) {
  const out: Record<string, string | { url?: string; username?: string; followers?: number | null }> = {}
  for (const [key, link] of Object.entries(value ?? {})) {
    if (FORBIDDEN_PUBLIC_PROFILE_KEY_RE.test(key)) continue
    const publicValue = publicSocialLinkValue(link)
    if (publicValue) out[key] = publicValue
  }
  return out
}

export function toPublicCandidatoProfileDto(ficha: FichaCandidato) {
  return {
    id: ficha.id,
    nome_completo: ficha.nome_completo,
    nome_urna: ficha.nome_urna,
    slug: ficha.slug,
    data_nascimento: ficha.data_nascimento,
    idade: ficha.idade,
    naturalidade: ficha.naturalidade,
    formacao: ficha.formacao,
    profissao_declarada: ficha.profissao_declarada,
    genero: ficha.genero ?? null,
    estado_civil: ficha.estado_civil ?? null,
    cor_raca: ficha.cor_raca ?? null,
    partido_atual: ficha.partido_atual,
    partido_sigla: ficha.partido_sigla,
    cargo_atual: ficha.cargo_atual,
    cargo_disputado: ficha.cargo_disputado,
    estado: ficha.estado,
    status: ficha.status,
    situacao_candidatura: ficha.situacao_candidatura ?? null,
    biografia: maskNullableText(ficha.biografia),
    foto_url: ficha.foto_url,
    site_campanha: ficha.site_campanha,
    redes_sociais: publicSocialLinks(ficha.redes_sociais),
    fonte_dados: [...(ficha.fonte_dados ?? [])],
    ultima_atualizacao: ficha.ultima_atualizacao,
    historico: (ficha.historico ?? []).map(publicHistorico),
    mudancas_partido: (ficha.mudancas_partido ?? []).map(publicMudancaPartido),
    patrimonio: (ficha.patrimonio ?? []).map(publicPatrimonio),
    financiamento: (ficha.financiamento ?? []).map(publicFinanciamento),
    votos: (ficha.votos ?? []).map(publicVoto),
    processos: (ficha.processos ?? []).map(publicProcesso),
    pontos_atencao: (ficha.pontos_atencao ?? []).map(publicPontoAtencao),
    projetos_lei: (ficha.projetos_lei ?? []).map(publicProjetoLei),
    projetos_lei_total: ficha.projetos_lei_total ?? (ficha.projetos_lei ?? []).length,
    projetos_lei_truncados: ficha.projetos_lei_truncados ?? false,
    legislacao_mandato_executivo: (ficha.legislacao_mandato_executivo ?? []).map(
      publicLegislacaoMandatoExecutivo
    ),
    gastos_parlamentares: (ficha.gastos_parlamentares ?? []).map(publicGastosParlamentares),
    sancoes_administrativas: (ficha.sancoes_administrativas ?? []).map(publicSancao),
    noticias: (ficha.noticias ?? []).map(publicNoticia),
    indicadores_estaduais: (ficha.indicadores_estaduais ?? []).map(publicIndicador),
    total_processos: ficha.total_processos,
    processos_criminais: ficha.processos_criminais,
    total_mudancas_partido: ficha.total_mudancas_partido,
    total_pontos_atencao: ficha.total_pontos_atencao,
    pontos_criticos: ficha.pontos_criticos,
    total_sancoes: ficha.total_sancoes,
    historico_descartado: ficha.historico_descartado ?? 0,
    historico_em_revisao: ficha.historico_em_revisao ?? false,
    timeline_partidaria_incompleta: ficha.timeline_partidaria_incompleta ?? false,
    section_freshness: ficha.section_freshness ?? {},
  }
}

export type PublicCandidatoProfileDto = ReturnType<typeof toPublicCandidatoProfileDto>

export function toPublicProjetosLeiDto(rows: ProjetoLei[]) {
  return rows.map(publicProjetoLei)
}

export function findForbiddenPublicProfileKeys(value: unknown): string[] {
  const found = new Set<string>()
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }

    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_PUBLIC_PROFILE_KEY_RE.test(key)) {
        found.add(key)
      }
      visit(child)
    }
  }

  visit(value)
  return [...found].sort()
}
