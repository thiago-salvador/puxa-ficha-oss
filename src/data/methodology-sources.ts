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
 *
 * REGRA DE HONESTIDADE (auditoria de integridade 2026-07-24, achados A0.3 e F4).
 * Esta lista e uma promessa publica em /metodologia. Duas coisas mudaram na
 * etapa 2C:
 *
 * 1. Fonte so entra aqui quando ja existe dado publicado. A entrada "Cadastro
 *    de Sancoes (CGU)" foi removida: o ingest existe
 *    (`scripts/lib/ingest-transparencia-sanctions.ts`), mas
 *    `public.sancoes_administrativas` tinha 0 linhas em 2026-07-25 e nenhum
 *    componente de `src/components/` ou `src/app/(site)/` renderiza o campo.
 *    Prometer fonte sem dado e sem superficie e promessa vazia. O caminho para
 *    religar esta em `docs/fontes-pendentes.md`.
 *
 * 2. `updateFrequency` descreve cadencia REAL e verificavel, nao intencao.
 *    "diaria" so vale com cron de producao (`vercel.json`) ou `schedule:` em
 *    `.github/workflows/`. Estado em 2026-07-29:
 *      - Google News: diaria, via cron `0 8 * * *` de `/api/news/refresh` em
 *        `vercel.json`.
 *      - Camara e Senado: semanal, via `schedule: 0 6 * * 3` em
 *        `.github/workflows/ingest.yml` (adicionado 2026-07-29). Se o cron
 *        sair ou mudar de cadencia, este rotulo muda no MESMO commit.
 *      - Todo o resto roda por lote manual, que e exatamente o que
 *        "sob demanda" descreve.
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
    // Sem automação: lote manual via workflow_dispatch (verificado 2026-07-25).
    updateFrequency: "sob demanda",
    curationType: "automático",
    curationNote: "CSVs do TSE baixados e processados em lote, quando há atualização na base de origem.",
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
    // Automação real: schedule semanal (0 6 * * 3) em .github/workflows/ingest.yml.
    updateFrequency: "semanal",
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
    // Automação real: schedule semanal (0 6 * * 3) em .github/workflows/ingest.yml.
    updateFrequency: "semanal",
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
    // Sem automação: lote manual via workflow_dispatch (verificado 2026-07-25).
    updateFrequency: "sob demanda",
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
    // Sem automação: lote manual via workflow_dispatch (verificado 2026-07-25).
    updateFrequency: "sob demanda",
    curationType: "automático",
  },
  // REMOVIDO na etapa 2C (auditoria 2026-07-24, achado A0.3): "Cadastro de
  // Sanções (CGU)" (CEIS, CNEP, CEPIM). O ingest existe em
  // scripts/lib/ingest-transparencia-sanctions.ts e continua no repositório,
  // mas em 2026-07-25 a tabela public.sancoes_administrativas tinha 0 linhas e
  // nenhum componente renderiza o dado. Volta para esta lista quando as duas
  // condições forem verdadeiras ao mesmo tempo: tabela com linha e superfície
  // de exibição na ficha. Checklist em docs/fontes-pendentes.md.
  {
    id: "filiacao",
    name: "TSE: Filiação Partidária",
    url: "https://dadosabertos.tse.jus.br",
    description:
      "Registro de filiação partidária dos candidatos para timeline de mudanças de partido.",
    dataTypes: ["Filiação e desfiliação partidária"],
    sourceKind: "base_oficial",
    // Sem automação: lote manual via workflow_dispatch (verificado 2026-07-25).
    updateFrequency: "sob demanda",
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
    // Sem automação: lote manual via workflow_dispatch (verificado 2026-07-25).
    updateFrequency: "sob demanda",
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
    // Sem automação: lote manual via workflow_dispatch (verificado 2026-07-25).
    updateFrequency: "sob demanda",
    curationType: "misto",
    curationNote:
      "Ingest automático de Wikidata; curadoria editorial para resolução de ambiguidades e dados faltantes.",
  },
  {
    id: "google-news",
    name: "Google News",
    url: "https://news.google.com",
    description:
      "Notícias recentes sobre cada candidato, agregadas diariamente. Só entra no perfil a matéria cujo título cita o candidato.",
    dataTypes: ["Notícias recentes"],
    sourceKind: "fonte_publica_complementar",
    // Única fonte com automação real: cron "0 8 * * *" de /api/news/refresh
    // em vercel.json (verificado 2026-07-25).
    updateFrequency: "diária",
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
