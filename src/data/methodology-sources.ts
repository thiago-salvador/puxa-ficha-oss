export interface MethodologySource {
  id: string
  name: string
  url: string
  description: string
  dataTypes: string[]
  sourceKind: "base_oficial" | "fonte_publica_complementar"
  updateFrequency: "diária" | "semanal" | "mensal" | "por ciclo eleitoral" | "sob demanda"
  curationType: "automático" | "curadoria" | "misto"
  curationNote?: string
}

/**
 * Registry centralizado de todas as fontes de dados usadas no Puxa Ficha.
 * Mantido em sincronia com `scripts/ingest-all.ts` e `scripts/lib/ingest-*.ts`.
 */
export const METHODOLOGY_SOURCES: readonly MethodologySource[] = [
  // --- Fontes federais (candidatos) ---
  {
    id: "tse",
    name: "TSE (Tribunal Superior Eleitoral)",
    url: "https://dadosabertos.tse.jus.br",
    description:
      "Fonte primária de candidaturas, patrimônio declarado, financiamento de campanha e situação da candidatura.",
    dataTypes: [
      "Candidaturas e dados cadastrais",
      "Patrimônio declarado",
      "Financiamento de campanha (receitas e despesas)",
      "Situação da candidatura e CPF",
      "Certidões criminais",
    ],
    sourceKind: "base_oficial",
    updateFrequency: "semanal",
    curationType: "automático",
    curationNote: "CSVs do TSE baixados e processados semanalmente.",
  },
  {
    id: "tse-historico",
    name: "TSE: Histórico Eleitoral",
    url: "https://dadosabertos.tse.jus.br",
    description:
      "Consulta de candidaturas passadas, de 1994 a 2024, para reconstruir o histórico político de cada candidato.",
    dataTypes: [
      "Candidaturas anteriores (cargo, partido, UF, ano)",
      "Mudanças de partido ao longo dos ciclos",
    ],
    sourceKind: "base_oficial",
    updateFrequency: "por ciclo eleitoral",
    curationType: "misto",
    curationNote:
      "Ingest automático dos CSVs; curadoria editorial para resolução de duplicatas e cargo canônico.",
  },
  {
    id: "camara",
    name: "Câmara dos Deputados",
    url: "https://dadosabertos.camara.leg.br",
    description:
      "API REST da Câmara com votações nominais, gastos parlamentares e projetos de lei.",
    dataTypes: [
      "Votações nominais em plenário",
      "Gastos parlamentares (CEAP)",
      "Projetos de lei (autorias)",
      "Frentes parlamentares",
    ],
    sourceKind: "base_oficial",
    updateFrequency: "diária",
    curationType: "automático",
  },
  {
    id: "senado",
    name: "Senado Federal",
    url: "https://legis.senado.leg.br/dadosabertos",
    description:
      "API do Senado com votações, autorias de projetos e dados de mandatos.",
    dataTypes: [
      "Votações nominais",
      "Autorias de proposições",
      "Mandatos e comissões",
    ],
    sourceKind: "base_oficial",
    updateFrequency: "diária",
    curationType: "automático",
  },
  {
    id: "transparencia",
    name: "Portal da Transparência (CGU)",
    url: "https://portaldatransparencia.gov.br",
    description:
      "Dados complementares de gastos, contratos e viagens de servidores e parlamentares.",
    dataTypes: [
      "Gastos e contratos públicos",
      "Viagens a serviço",
    ],
    sourceKind: "base_oficial",
    updateFrequency: "diária",
    curationType: "automático",
  },
  {
    id: "tcu",
    name: "TCU (Tribunal de Contas da União)",
    url: "https://portal.tcu.gov.br",
    description:
      "Processos e julgamentos do TCU que envolvam candidatos.",
    dataTypes: ["Processos e condenações no TCU"],
    sourceKind: "base_oficial",
    updateFrequency: "diária",
    curationType: "automático",
  },
  {
    id: "sancoes",
    name: "Cadastro de Sanções (CGU)",
    url: "https://portaldatransparencia.gov.br",
    description:
      "CEIS, CNEP e CEPIM: listas de impedimentos, sanções e entidades punidas vinculadas a candidatos.",
    dataTypes: ["Sanções administrativas e impedimentos"],
    sourceKind: "base_oficial",
    updateFrequency: "diária",
    curationType: "automático",
  },
  {
    id: "filiacao",
    name: "TSE: Filiação Partidária",
    url: "https://dadosabertos.tse.jus.br",
    description:
      "Registro de filiação partidária dos candidatos para timeline de mudanças de partido.",
    dataTypes: ["Filiação e desfiliação partidária"],
    sourceKind: "base_oficial",
    updateFrequency: "semanal",
    curationType: "automático",
  },
  {
    id: "ceaps-senado",
    name: "CEAPS (Senado)",
    url: "https://www12.senado.leg.br/transparencia",
    description:
      "Cota para Exercício da Atividade Parlamentar dos Senadores.",
    dataTypes: ["Gastos parlamentares de senadores"],
    sourceKind: "base_oficial",
    updateFrequency: "mensal",
    curationType: "automático",
  },
  {
    id: "jarbas",
    name: "Jarbas (Serenata de Amor)",
    url: "https://jarbas.serenata.ai",
    description:
      "Gastos suspeitos da CEAP identificados pelo projeto Serenata de Amor.",
    dataTypes: ["Suspeitas de irregularidades em CEAP"],
    sourceKind: "fonte_publica_complementar",
    updateFrequency: "sob demanda",
    curationType: "automático",
  },

  // --- Enriquecimento (biografias, fotos, redes) ---
  {
    id: "wikipedia",
    name: "Wikipedia / Wikidata",
    url: "https://pt.wikipedia.org",
    description:
      "Biografias, fotos, dados demográficos, redes sociais e histórico político complementar.",
    dataTypes: [
      "Biografia e foto",
      "Dados demográficos",
      "Redes sociais",
      "Histórico político complementar",
    ],
    sourceKind: "fonte_publica_complementar",
    updateFrequency: "semanal",
    curationType: "misto",
    curationNote:
      "Ingest automático de Wikidata; curadoria editorial para resolução de ambiguidades e dados faltantes.",
  },
  {
    id: "google-news",
    name: "Google News",
    url: "https://news.google.com",
    description:
      "Notícias recentes sobre cada candidato, agregadas semanalmente.",
    dataTypes: ["Notícias recentes"],
    sourceKind: "fonte_publica_complementar",
    updateFrequency: "semanal",
    curationType: "automático",
  },

  // --- Indicadores estaduais ---
  {
    id: "ibge",
    name: "IBGE · SIDRA",
    url: "https://servicodados.ibge.gov.br",
    description:
      "População estimada e PIB total por UF (séries dos agregados SIDRA).",
    dataTypes: ["População estimada", "PIB por UF"],
    sourceKind: "base_oficial",
    updateFrequency: "sob demanda",
    curationType: "automático",
  },
  {
    id: "ipea",
    name: "Ipeadata",
    url: "https://www.ipeadata.gov.br",
    description:
      "Taxa de desemprego, taxa de pobreza e índice de Gini por UF (PNAD Contínua).",
    dataTypes: ["Desemprego", "Pobreza", "Gini"],
    sourceKind: "base_oficial",
    updateFrequency: "sob demanda",
    curationType: "automático",
  },
  {
    id: "atlas-violencia",
    name: "Atlas da Violência (Ipea)",
    url: "https://www.ipea.gov.br/atlasviolencia/",
    description:
      "Homicídios e indicadores de violência letal por 100 mil habitantes.",
    dataTypes: ["Taxa de homicídios por UF"],
    sourceKind: "base_oficial",
    updateFrequency: "sob demanda",
    curationType: "automático",
  },
  {
    id: "ideb",
    name: "INEP · IDEB",
    url: "https://www.gov.br/inep/pt-br",
    description:
      "IDEB do ensino médio por UF, quando disponível na base.",
    dataTypes: ["IDEB do ensino médio"],
    sourceKind: "base_oficial",
    updateFrequency: "sob demanda",
    curationType: "automático",
  },
  {
    id: "capag",
    name: "Tesouro Transparente · CAPAG",
    url: "https://www.tesourotransparente.gov.br",
    description:
      "Notas e indicadores da CAPAG (capacidade de pagamento dos estados).",
    dataTypes: ["Nota CAPAG por UF"],
    sourceKind: "base_oficial",
    updateFrequency: "sob demanda",
    curationType: "automático",
  },
  {
    id: "siconfi",
    name: "Tesouro · Siconfi",
    url: "https://apidatalake.tesouro.gov.br/docs/siconfi/",
    description:
      "Receita, despesa, resultado primário e relação pessoal/RCL por UF (RREO/RGF).",
    dataTypes: ["Receitas e despesas estaduais", "Resultado primário", "Pessoal/RCL"],
    sourceKind: "base_oficial",
    updateFrequency: "sob demanda",
    curationType: "automático",
  },
] as const
