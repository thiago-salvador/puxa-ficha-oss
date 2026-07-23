// ============================================
// PUXA FICHA 2026
// TypeScript Types
// ============================================

// --- Candidato ---
export interface Candidato {
  id: string;
  nome_completo: string;
  nome_urna: string;
  slug: string;

  // Pessoal
  data_nascimento: string | null;
  idade: number | null;
  naturalidade: string | null;
  formacao: string | null;
  profissao_declarada: string | null;
  genero?: string | null;
  estado_civil?: string | null;
  cor_raca?: string | null;

  // Político
  partido_atual: string;
  partido_sigla: string;
  cargo_atual: string | null;
  cargo_disputado:
    | 'Presidente'
    | 'Governador'
    | 'Vice-Governador'
    | 'Senador'
    | 'Deputado Federal'
    | 'Nenhum';
  estado: string | null; // UF pra governadores

  status: 'pre-candidato' | 'candidato' | 'indeferido' | 'desistente' | 'removido';
  situacao_candidatura?: string | null;
  biografia?: string | null;

  // Mídia
  foto_url: string | null;
  site_campanha: string | null;
  redes_sociais: Record<string, string>;

  // Meta
  fonte_dados: string[];
  ultima_atualizacao: string;
}

// --- Histórico Político ---
export interface HistoricoPolitico {
  id: string;
  candidato_id: string;
  cargo: string;
  /** Chave deduplicação; alinhada a `src/lib/cargo-utils.ts` (scripts re-exportam o mesmo). */
  cargo_canonico?: string | null;
  /** Mandato/posição vs pleito sem mandato; ver `curadoria interna` (Fluxo 2). */
  tipo_evento?: 'mandato' | 'candidatura' | null;
  /** Ano de início; pode ser null na base (evitar coagir a 0 — diverge da ficha pública). */
  periodo_inicio: number | null;
  periodo_fim: number | null;
  partido: string;
  estado: string;
  eleito_por: string;
  observacoes: string | null;
  /**
   * Proveniência persistida (`historico_politico.proveniencia`). Null = legado; ver `resolveHistoricoRowProvenance`.
   */
  proveniencia?: string | null;
}

// --- Mudança de Partido ---
export interface MudancaPartido {
  id: string;
  candidato_id: string;
  partido_anterior: string;
  partido_novo: string;
  data_mudanca: string | null;
  ano: number;
  contexto: string | null;
}

// --- Patrimônio ---
export interface Patrimonio {
  id: string;
  candidato_id: string;
  ano_eleicao: number;
  valor_total: number;
  bens: BemDeclarado[];
}

export interface BemDeclarado {
  tipo: string;
  descricao: string;
  valor: number;
}

// --- Financiamento ---
export interface Financiamento {
  id: string;
  candidato_id: string;
  ano_eleicao: number;
  total_arrecadado: number;
  total_fundo_partidario: number;
  total_fundo_eleitoral: number;
  total_pessoa_fisica: number;
  total_recursos_proprios: number;
  maiores_doadores: Doador[];
}

export interface Doador {
  nome: string;
  valor: number;
  tipo: 'PF' | 'PJ' | 'fundo_partidario' | 'fundo_eleitoral' | 'recursos_proprios';
  /** CNPJ 14 dígitos quando a fonte TSE/ingest trouxer documento PJ. */
  cnpj?: string;
  /** Referência unidirecional a PF; não é o CPF em claro. Só preenchido com ingest + salt dedicado. */
  cpf_hash?: string;
}

// --- Votações ---
export interface VotacaoChave {
  id: string;
  titulo: string;
  descricao: string;
  data_votacao: string;
  casa: 'Câmara' | 'Senado';
  tema: string;
  impacto_popular: string;
  /** ID da proposição na Câmara ou Senado, usado para link e explicação de fonte. Null quando não disponível. */
  proposicao_id?: string | null;
}

export interface VotoCandidato {
  id: string;
  candidato_id: string;
  votacao_id: string;
  voto: 'sim' | 'não' | 'abstenção' | 'ausente' | 'obstrução';
  contradicao: boolean;
  contradicao_descricao: string | null;

  // Joined
  votacao?: VotacaoChave;
}

// --- Processos ---
export interface Processo {
  id: string;
  candidato_id: string;
  tipo: 'criminal' | 'improbidade' | 'eleitoral' | 'civil';
  tribunal: string;
  numero_processo: string | null;
  descricao: string;
  status: 'em_andamento' | 'condenado' | 'absolvido' | 'prescrito';
  data_inicio: string | null;
  data_decisao: string | null;
  gravidade: 'alta' | 'media' | 'baixa';
}

// --- Pontos de Atenção ---
export interface PontoAtencao {
  id: string;
  candidato_id: string;
  categoria:
    | 'corrupção'
    | 'contradição'
    | 'financiamento_suspeito'
    | 'mudança_partido'
    | 'processo_grave'
    | 'patrimonio_incompativel'
    | 'feito_positivo'
    | 'escandalo';
  titulo: string;
  descricao: string;
  fontes: FonteReferencia[];
  gravidade: 'critica' | 'alta' | 'media' | 'baixa';
  visivel?: boolean;
  verificado: boolean;
  gerado_por: 'ia' | 'curadoria' | 'automatico';
  /** Data factual do fato (YYYY-MM-DD); timeline publica usa quando preenchida. */
  data_referencia?: string | null;
}

export interface FonteReferencia {
  titulo: string;
  url: string;
  data: string;
}

// --- Projetos de Lei ---
export interface ProjetoLei {
  id: string;
  candidato_id: string;
  tipo: string; // "PL", "PEC", "PLP", etc.
  numero: string | null;
  ano: number | null;
  ementa: string | null;
  tema: string | null;
  situacao: string | null; // "tramitando", "aprovado", "arquivado", "vetado"
  url_inteiro_teor: string | null;
  destaque: boolean;
  destaque_motivo: string | null;
  fonte: string;
  /** ID da proposição na API da Câmara ou Senado, usado para audit, dedupe ou link de fonte. */
  proposicao_id_api?: string | null;
  /** Etiqueta de cobertura da autoria parlamentar verificada (slug+orgao+janela). Espelha COMPLETE_PARLAMENTAR_AUTHORSHIP_COVERAGE. */
  coverage_id?: string | null;
  /** Escopo formal do coverage_id (ex.: 'inventario_completo_camara_autoria_1991_2014_20260430'). */
  coverage_scope?: string | null;
  /** Provenance auditável (data_apresentacao, ordem_assinatura, total_autores, origem_lote, etc.). */
  metadata?: Record<string, unknown> | null;
}

// --- Legislação de Mandato Executivo ---
export type LegislacaoMandatoExecutivoTipoRelacao =
  | 'projeto_enviado_pelo_executivo'
  | 'lei_sancionada'
  | 'lei_promulgada_pelo_legislativo';

export type LegislacaoMandatoExecutivoEsfera = 'federal' | 'estadual' | 'municipal';

export type LegislacaoMandatoExecutivoAutoridadePapel =
  | 'titular'
  | 'vice_interino'
  | 'mesa_legislativa'
  | 'outro'
  | 'nao_informado';

export interface LegislacaoMandatoExecutivo {
  id: string;
  candidato_id: string;
  historico_politico_id: string | null;
  tipo_relacao: LegislacaoMandatoExecutivoTipoRelacao;
  esfera: LegislacaoMandatoExecutivoEsfera;
  uf_norma: string | null;
  municipio_norma: string | null;
  tipo_norma: string | null;
  numero: string | null;
  ano: number | null;
  data_norma: string | null;
  ementa: string | null;
  signatario: string | null;
  autoridade_papel: LegislacaoMandatoExecutivoAutoridadePapel;
  fonte_primaria_url: string;
  fonte_primaria_titulo: string | null;
  fonte_tramitacao_url: string | null;
  identificador_fonte: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// --- Gastos Parlamentares ---
export interface GastoParlamentar {
  id: string;
  candidato_id: string;
  ano: number;
  total_gasto: number;
  detalhamento: GastoCategoria[];
  gastos_destaque: GastoDestaque[];
}

export interface GastoCategoria {
  categoria: string;
  valor: number;
  fornecedor?: string;
}

export interface GastoDestaque {
  descricao: string;
  valor: number;
  categoria: string;
}

// --- Sancoes Administrativas ---
export interface SancaoAdministrativa {
  id: string;
  candidato_id: string;
  tipo: 'CEIS' | 'CNEP' | 'CEAF' | 'CEPIM';
  descricao: string | null;
  orgao_sancionador: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  fundamentacao: string | null;
  vinculo: 'direto' | 'empresa_associada';
  cnpj_empresa: string | null;
}

// --- Indicadores Estaduais ---
export interface IndicadorEstadual {
  id: string;
  estado: string;
  ano: number;
  fonte: string;
  indicador: string;
  valor: number | null;
  valor_texto: string | null;
  unidade: string | null;
  metadata: Record<string, unknown> | null;
}

/** Linha minima para ranking nacional (payload leve). */
export interface IndicadorEstadualRanking {
  id: string;
  estado: string;
  ano: number;
  indicador: string;
  valor: number | null;
  /** Chave da origem no banco (ex.: ibge_sidra, ipeadata). */
  fonte?: string | null;
}

// --- Noticias ---
export interface NoticiaCandidato {
  id: string;
  candidato_id: string;
  titulo: string;
  fonte: string | null;
  url: string;
  data_publicacao: string;
  snippet: string | null;
}

// --- Estado da fonte de dados ---
export type DataSourceStatus = 'live' | 'degraded';

export interface DataResource<T> {
  data: T;
  sourceStatus: DataSourceStatus;
  sourceMessage?: string | null;
}

export type SectionFreshnessStatus =
  | "current"
  | "historical"
  | "stale"
  | "missing";

export type SectionFreshnessKey =
  | "perfil_atual"
  | "historico_politico"
  | "mudancas_partido"
  | "patrimonio"
  | "financiamento"
  | "projetos_lei"
  | "votos_candidato"
  | "gastos_parlamentares";

export interface SectionFreshnessInfo {
  key: SectionFreshnessKey;
  label: string;
  status: SectionFreshnessStatus;
  verifiedAt?: string | null;
  referenceDate: string | null;
  referenceYear: number | null;
  sourceLabel?: string | null;
  message: string;
}

// --- Views compostas ---

export interface FichaCandidato extends Candidato {
  historico: HistoricoPolitico[];
  mudancas_partido: MudancaPartido[];
  patrimonio: Patrimonio[];
  financiamento: Financiamento[];
  votos: VotoCandidato[];
  processos: Processo[];
  pontos_atencao: PontoAtencao[];
  projetos_lei: ProjetoLei[];
  /** Total materializado; `projetos_lei` pode conter apenas a prévia inicial. */
  projetos_lei_total?: number;
  /** Indica que o cliente deve buscar o inventário completo sob demanda. */
  projetos_lei_truncados?: boolean;
  legislacao_mandato_executivo: LegislacaoMandatoExecutivo[];
  gastos_parlamentares: GastoParlamentar[];
  sancoes_administrativas: SancaoAdministrativa[];
  noticias: NoticiaCandidato[];
  indicadores_estaduais?: IndicadorEstadual[];

  // Contadores
  total_processos: number;
  processos_criminais: number;
  /** Número de trocas efetivas (exclui linha âncora de filiação inicial quando aplicável). */
  total_mudancas_partido: number;
  total_pontos_atencao: number;
  pontos_criticos: number;
  total_sancoes: number;

  // Integridade factual da superficie publicada
  historico_descartado?: number;
  historico_em_revisao?: boolean;
  timeline_partidaria_incompleta?: boolean;
  section_freshness?: Partial<Record<SectionFreshnessKey, SectionFreshnessInfo>>;
}

export interface CandidatoComparavel {
  id: string;
  nome_urna: string;
  slug: string;
  partido_sigla: string;
  cargo_disputado: string;
  estado: string | null;
  foto_url: string | null;
  idade: number | null;
  formacao: string | null;
  total_processos: number;
  mudancas_partido: number;
  alertas_graves: number;
  patrimonio_declarado: number | null;
  /** Soma de `total_gasto` em `gastos_parlamentares` — alinhada ao ranking gastos-parlamentares. */
  total_gasto_parlamentar: number | null;
  /** Quantidade de votações-chave com voto registrado (`votos_candidato`). */
  total_votos_mapeados: number;
}
