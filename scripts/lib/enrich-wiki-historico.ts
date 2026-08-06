import { supabase } from "./supabase"
import { loadCandidatosPublicos } from "./helpers-db"
import { sleep } from "./helpers"
import { log, warn } from "./logger"
import { canonicalizeEstadoForStorage } from "@/lib/br-uf"
import type { IngestResult } from "./types"

// Slug → Portuguese Wikipedia article title (reuse from enrich-wikipedia.ts)
// We import only the titles we need by re-reading the main file
const WIKI_API = "https://pt.wikipedia.org/w/api.php"
const slugArg = process.argv.find((arg) => arg.startsWith("--slug="))
const filterSlugs = slugArg
  ? new Set(
      slugArg
        .slice("--slug=".length)
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean),
    )
  : null

// Category patterns that indicate political positions
const CARGO_PATTERNS: Array<{
  pattern: RegExp
  cargo: string
  extractEstado?: boolean
}> = [
  { pattern: /^Deputados federais do Brasil por (.+)$/i, cargo: "Deputado Federal", extractEstado: true },
  { pattern: /^Senadores do Brasil por (.+)$/i, cargo: "Senador", extractEstado: true },
  { pattern: /^Governadores d[eoa] (.+)$/i, cargo: "Governador", extractEstado: true },
  { pattern: /^Vice-governadores d[eoa] (.+)$/i, cargo: "Vice-Governador", extractEstado: true },
  { pattern: /^Prefeitos d[eoa] (.+)$/i, cargo: "Prefeito", extractEstado: true },
  { pattern: /^Vice-prefeitos d[eoa] (.+)$/i, cargo: "Vice-Prefeito", extractEstado: true },
  { pattern: /^Deputados estaduais d[eoa] (.+)$/i, cargo: "Deputado Estadual", extractEstado: true },
  { pattern: /^Vereadores d[eoa] (.+)$/i, cargo: "Vereador", extractEstado: true },
  { pattern: /^Ministros d[eoa] (.+) do Brasil$/i, cargo: "Ministro" },
  { pattern: /^Presidentes da C[aâ]mara dos Deputados do Brasil$/i, cargo: "Presidente da Câmara dos Deputados" },
  { pattern: /^Presidentes do Senado Federal do Brasil$/i, cargo: "Presidente do Senado Federal" },
  { pattern: /^Secretários estaduais/i, cargo: "Secretário Estadual" },
]

// State name normalization delegated to br-uf.ts (single source of truth)

interface WikiCategory {
  title?: string
}

interface WikiPage {
  categories?: WikiCategory[]
}

interface WikiQueryResponse {
  query?: {
    pages?: Record<string, WikiPage>
  }
}

function normalizeEstado(name: string): string {
  return canonicalizeEstadoForStorage(name) ?? name
}

type WikiCategoriesResult =
  | { categories: string[]; error: null }
  | { categories: []; error: string }

async function fetchWikiCategories(title: string): Promise<WikiCategoriesResult> {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "categories",
    cllimit: "100",
    format: "json",
    origin: "*",
  })

  let ultimoErro = "erro desconhecido"
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      const res = await fetch(`${WIKI_API}?${params}`, {
        headers: { "User-Agent": "PuxaFicha/1.0 (puxaficha.com.br)" },
      })
      if (!res.ok) {
        ultimoErro = `HTTP ${res.status}`
        if ((res.status === 429 || res.status >= 500) && tentativa < 5) {
          const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10)
          const esperaMs = Number.isFinite(retryAfter)
            ? Math.max(1_000, retryAfter * 1_000)
            : Math.min(60_000, 5_000 * 2 ** (tentativa - 1))
          await sleep(esperaMs)
          continue
        }
        return { categories: [], error: ultimoErro }
      }
      const json = (await res.json()) as WikiQueryResponse
      const pages = json.query?.pages ?? {}
      const page = Object.values(pages)[0]
      return {
        categories: (page?.categories ?? [])
          .map((c) => c.title?.replace("Categoria:", "") ?? "")
          .filter(Boolean),
        error: null,
      }
    } catch (err) {
      ultimoErro = err instanceof Error ? err.message : String(err)
      if (tentativa < 5) {
        await sleep(Math.min(60_000, 5_000 * 2 ** (tentativa - 1)))
        continue
      }
    }
  }
  return { categories: [], error: ultimoErro }
}

function extractCargosFromCategories(categories: string[]): Array<{
  cargo: string
  estado: string
}> {
  const cargos: Array<{ cargo: string; estado: string }> = []

  for (const cat of categories) {
    for (const p of CARGO_PATTERNS) {
      const match = cat.match(p.pattern)
      if (match) {
        const estado = p.extractEstado && match[1]
          ? normalizeEstado(match[1])
          : ""
        cargos.push({ cargo: p.cargo, estado })
        break
      }
    }
  }

  return cargos
}

export async function enrichWikiHistorico(): Promise<IngestResult[]> {
  const candidatos = await loadCandidatosPublicos()
  const results: IngestResult[] = []
  const comTitulo = candidatos.filter(
    (cand) =>
      Boolean(cand.wikipedia_title?.trim()) &&
      (!filterSlugs || filterSlugs.has(cand.slug)),
  )

  log("wiki-historico", `Titulos Wikipedia carregados: ${comTitulo.length}`)

  const totalInserted = 0
  let totalSkipped = 0

  // Categoria da Wikipedia nao traz `periodo_inicio`, e o banco recusa cargo
  // sem data. A fonte, portanto, serve aqui para confirmar que a busca ocorreu e
  // explicar por que nao existe escrita. O desfecho fica no IngestResult para o
  // orquestrador registrar toda consulta aplicavel, inclusive resposta vazia e
  // falha de rede, sem confundir as duas.
  for (const cand of comTitulo) {
    const wikiTitle = cand.wikipedia_title!.trim()
    const result: IngestResult = {
      source: "wiki-historico",
      candidato: cand.slug,
      tables_updated: [],
      rows_upserted: 0,
      errors: [],
      duration_ms: 0,
    }
    const start = Date.now()

    // Get candidate ID from DB
    const { data: dbCand, error: dbCandError } = await supabase
      .from("candidatos")
      .select("id, partido_sigla")
      .eq("slug", cand.slug)
      .single()

    if (dbCandError || !dbCand) {
      const detalhe = dbCandError?.message ?? "candidato nao encontrado no banco"
      result.errors.push(detalhe)
      result.coleta_resultado = "erro"
      result.coleta_detalhe = detalhe
      result.duration_ms = Date.now() - start
      results.push(result)
      continue
    }

    // Check existing historico
    const { data: existing, error: existingError } = await supabase
      .from("historico_politico")
      .select("cargo, estado")
      .eq("candidato_id", dbCand.id)

    if (existingError) {
      result.errors.push(existingError.message)
      result.coleta_resultado = "erro"
      result.coleta_detalhe = existingError.message
      result.duration_ms = Date.now() - start
      results.push(result)
      continue
    }

    const existingSet = new Set(
      (existing ?? []).map((h) => `${h.cargo}|${h.estado}`)
    )

    // Fetch Wikipedia categories
    const resposta = await fetchWikiCategories(wikiTitle)
    await sleep(1_100)

    if (resposta.error) {
      result.errors.push(resposta.error)
      result.coleta_resultado = "erro"
      result.coleta_detalhe = resposta.error
      result.duration_ms = Date.now() - start
      results.push(result)
      continue
    }

    if (resposta.categories.length === 0) {
      result.coleta_resultado = "vazio_confirmado"
      result.coleta_detalhe = "Wikipedia respondeu sem categorias"
      result.duration_ms = Date.now() - start
      results.push(result)
      continue
    }

    const cargos = extractCargosFromCategories(resposta.categories)
    result.coleta_resultado = "nao_aplicavel"
    result.coleta_detalhe =
      cargos.length === 0
        ? `${resposta.categories.length} categoria(s), nenhuma categoria de cargo reconhecida`
        : `${cargos.length} cargo(s) na categoria, nenhum com periodo_inicio utilizavel`

    log("wiki-historico", `${cand.slug}: ${cargos.length} cargos encontrados via categorias`)

    for (const c of cargos) {
      const key = `${c.cargo}|${c.estado}`
      if (existingSet.has(key)) {
        totalSkipped++
        continue
      }

      // Guard: do not insert records without a valid periodo_inicio (> 1900).
      // Wikipedia categories do not provide dates, so skip instead of inserting placeholder 0.
      warn("wiki-historico", `${cand.slug}: skipping ${c.cargo} (no periodo_inicio from categories)`)
      totalSkipped++
    }
    result.duration_ms = Date.now() - start
    results.push(result)
  }

  console.log(`\n=== Wikipedia Historico ===`)
  console.log(`Cargos inseridos: ${totalInserted}`)
  console.log(`Duplicatas ignoradas: ${totalSkipped}`)
  console.log(`Erros: ${results.reduce((sum, result) => sum + result.errors.length, 0)}`)
  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  enrichWikiHistorico().then((r) => console.log(JSON.stringify(r, null, 2)))
}
