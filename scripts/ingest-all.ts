import { ingestCamara } from "./lib/ingest-camara"
import { ingestSenado } from "./lib/ingest-senado"
import { ingestTSE } from "./lib/ingest-tse"
import { ingestTransparencia } from "./lib/ingest-transparencia"
import { enrichWikipedia } from "./lib/enrich-wikipedia"
import { ingestTCU } from "./lib/ingest-tcu"
import { ingestTransparenciaSanctions } from "./lib/ingest-transparencia-sanctions"
import { ingestTSESituacao } from "./lib/ingest-tse-situacao"
import { ingestFiliacao } from "./lib/ingest-filiacao"
import { ingestTSEHistorico } from "./lib/ingest-tse-historico"
import { ingestCeapsSenado } from "./lib/ingest-ceaps-senado"
import { ingestWikidata } from "./lib/ingest-wikidata"
import { enrichInstagram } from "./lib/enrich-instagram"
import { ingestGoogleNews } from "./lib/ingest-google-news"
import { enrichWikiHistorico } from "./lib/enrich-wiki-historico"
import { ingestWikidataPolitico } from "./lib/ingest-wikidata-politico"
import { ingestJarbas } from "./lib/ingest-jarbas"
import { ingestSiconfi } from "./lib/ingest-siconfi"
import { ingestCapag } from "./lib/ingest-capag"
import { ingestAtlasViolencia } from "./lib/ingest-atlas-violencia"
import { ingestIbge } from "./lib/ingest-ibge"
import { ingestIdeb } from "./lib/ingest-ideb"
import { ingestIpea } from "./lib/ingest-ipea"
import { log, error } from "./lib/logger"
import type { IngestResult } from "./lib/types"

const VALID_SOURCES = [
  // Ordem correta: tse-situacao primeiro (CPF), depois APIs federais, depois enriquecimento
  "tse-situacao", "camara", "senado", "tse", "transparencia",
  "tcu", "sancoes", "tse-historico", "filiacao", "ceaps-senado", "jarbas",
  "wikipedia", "wiki-historico", "wikidata", "wikidata-politico", "instagram",
  "siconfi", "capag", "atlas-violencia", "ibge", "ideb", "ipea",
  "google-news",
] as const

type IngestSource = (typeof VALID_SOURCES)[number]

type IngestTask = {
  source: IngestSource
  heading: string
  failureLabel: string
  before?: () => void
  run: () => Promise<IngestResult[] | void>
}

const rawArgv = process.argv.slice(2)
const skipCamaraValidated = rawArgv.includes("--skip-camara-validated")
const args = rawArgv.filter((a) => !a.startsWith("-"))
const sources = parseSources(args)

function parseSources(input: string[]): IngestSource[] {
  const selected = input.length > 0 ? input : [...VALID_SOURCES]
  for (const s of selected) {
    if (!VALID_SOURCES.includes(s as IngestSource)) {
      console.error(`Fonte desconhecida: ${s}. Validas: ${VALID_SOURCES.join(", ")}`)
      process.exit(1)
    }
  }

  return selected as IngestSource[]
}

const INGEST_TASKS: IngestTask[] = [
  {
    source: "tse-situacao",
    heading: "--- TSE Situacao da Candidatura + CPF ---",
    failureLabel: "TSE Situacao",
    run: ingestTSESituacao,
  },
  {
    source: "camara",
    heading: "--- Camara dos Deputados ---",
    failureLabel: "Camara",
    before: () => {
      if (!skipCamaraValidated) return
      log(
        "pipeline",
        "Flag --skip-camara-validated: modo incremental (pula candidato so se votos+projetos+gastos recentes ok; senao so etapas faltantes)"
      )
    },
    run: () => ingestCamara({ skipValidated: skipCamaraValidated }),
  },
  { source: "senado", heading: "--- Senado Federal ---", failureLabel: "Senado", run: ingestSenado },
  { source: "tse", heading: "--- TSE (CSV) ---", failureLabel: "TSE", run: ingestTSE },
  {
    source: "transparencia",
    heading: "--- Portal da Transparencia ---",
    failureLabel: "Transparencia",
    run: ingestTransparencia,
  },
  {
    source: "wikipedia",
    heading: "--- Wikipedia (bio, foto, redes) ---",
    failureLabel: "Wikipedia",
    run: enrichWikipedia,
  },
  {
    source: "wiki-historico",
    heading: "--- Wikipedia Historico (categorias) ---",
    failureLabel: "Wiki Historico",
    run: enrichWikiHistorico,
  },
  { source: "tcu", heading: "--- TCU (Inabilitados + CADIRREG) ---", failureLabel: "TCU", run: ingestTCU },
  {
    source: "sancoes",
    heading: "--- Portal da Transparencia (CEIS/CNEP/CEAF/CEPIM) ---",
    failureLabel: "Sancoes",
    run: ingestTransparenciaSanctions,
  },
  {
    source: "tse-historico",
    heading: "--- TSE Historico de Candidaturas ---",
    failureLabel: "TSE Historico",
    run: ingestTSEHistorico,
  },
  {
    source: "filiacao",
    heading: "--- TSE Filiacao Partidaria ---",
    failureLabel: "Filiacao",
    run: ingestFiliacao,
  },
  {
    source: "ceaps-senado",
    heading: "--- CEAPS Senado ---",
    failureLabel: "CEAPS Senado",
    run: ingestCeapsSenado,
  },
  { source: "wikidata", heading: "--- Wikidata ---", failureLabel: "Wikidata", run: ingestWikidata },
  {
    source: "wikidata-politico",
    heading: "--- Wikidata Politico (partidos + cargos) ---",
    failureLabel: "Wikidata Politico",
    run: ingestWikidataPolitico,
  },
  {
    source: "instagram",
    heading: "--- Instagram (seguidores) ---",
    failureLabel: "Instagram",
    run: enrichInstagram,
  },
  {
    source: "jarbas",
    heading: "--- Jarbas / Serenata de Amor ---",
    failureLabel: "Jarbas",
    run: ingestJarbas,
  },
  { source: "siconfi", heading: "--- SICONFI (gestao fiscal) ---", failureLabel: "SICONFI", run: ingestSiconfi },
  { source: "capag", heading: "--- CAPAG (rating fiscal) ---", failureLabel: "CAPAG", run: ingestCapag },
  {
    source: "atlas-violencia",
    heading: "--- Atlas da Violencia (IPEA) ---",
    failureLabel: "Atlas Violencia",
    run: ingestAtlasViolencia,
  },
  { source: "ibge", heading: "--- IBGE SIDRA ---", failureLabel: "IBGE", run: ingestIbge },
  { source: "ideb", heading: "--- INEP/IDEB ---", failureLabel: "IDEB", run: ingestIdeb },
  { source: "ipea", heading: "--- IPEA Data ---", failureLabel: "IPEA", run: ingestIpea },
  {
    source: "google-news",
    heading: "--- Google News RSS ---",
    failureLabel: "Google News",
    run: ingestGoogleNews,
  },
]

async function runIngestTask(task: IngestTask, allResults: IngestResult[]) {
  log("pipeline", task.heading)
  task.before?.()

  try {
    const results = await task.run()
    if (results) {
      allResults.push(...results)
    }
  } catch (err) {
    error("pipeline", `${task.failureLabel} falhou: ${err}`)
  }
}

function shouldShowHistoricoReminder(selectedSources: Set<IngestSource>): boolean {
  return selectedSources.has("tse-historico") || selectedSources.has("wikidata-politico")
}

async function main() {
  log("pipeline", `Iniciando ingestao: ${sources.join(", ")}`)
  const start = Date.now()
  const allResults: IngestResult[] = []
  const selectedSources = new Set(sources)

  for (const task of INGEST_TASKS) {
    if (selectedSources.has(task.source)) {
      await runIngestTask(task, allResults)
    }
  }

  const totalRows = allResults.reduce((s, r) => s + r.rows_upserted, 0)
  const totalErrors = allResults.reduce((s, r) => s + r.errors.length, 0)
  const duration = ((Date.now() - start) / 1000).toFixed(1)

  log("pipeline", ``)
  log("pipeline", `=== Resumo ===`)
  log("pipeline", `Tempo: ${duration}s`)
  log("pipeline", `Rows upserted: ${totalRows}`)
  log("pipeline", `Errors: ${totalErrors}`)

  if (totalErrors > 0) {
    log("pipeline", ``)
    log("pipeline", `Erros por candidato:`)
    for (const r of allResults.filter((r) => r.errors.length > 0)) {
      error("pipeline", `  ${r.source}/${r.candidato}: ${r.errors.join("; ")}`)
    }
    process.exit(1)
  }

  if (shouldShowHistoricoReminder(selectedSources)) {
    log(
      "pipeline",
      "Histórico: após alterar TSE/Wikidata, rode `npx tsx scripts/audit-factual.ts` (ou o relatório CI) para validar duplicatas/observações."
    )
  }
}

main()
