import { supabase } from "./supabase"
import { resolveCandidatoId } from "./helpers-db"
import { loadCandidatos, fetchJSON, sleep } from "./helpers"
import { log, warn } from "./logger"
import type { IngestResult } from "./types"

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
const HEADERS = {
  Accept: "application/sparql-results+json",
  "User-Agent": "PuxaFicha/1.0 (puxaficha.com.br)",
}

interface SparqlBinding {
  item?: { value: string }
  instagram?: { value: string }
  twitter?: { value: string }
  facebook?: { value: string }
  site?: { value: string }
  foto?: { value: string }
  nascimento?: { value: string }
  profissao?: { value: string }
  idCamara?: { value: string }
  idSenado?: { value: string }
}

interface SparqlResponse {
  results: {
    bindings: SparqlBinding[]
  }
}

interface RedesSociais {
  instagram?: { username: string; url: string; followers?: number | null }
  twitter?: string
  facebook?: string
  site_oficial?: string
}

const OPTIONAL_PROPS = `
  OPTIONAL { ?item wdt:P2003 ?instagram }
  OPTIONAL { ?item wdt:P2002 ?twitter }
  OPTIONAL { ?item wdt:P2013 ?facebook }
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P18 ?foto }
  OPTIONAL { ?item wdt:P569 ?nascimento }
  OPTIONAL { ?item wdt:P106 ?profissao }
  OPTIONAL { ?item wdt:P6947 ?idCamara }
  OPTIONAL { ?item wdt:P7662 ?idSenado }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en" }
`

async function queryWikidataById(wikidataId: string): Promise<SparqlBinding | null> {
  const query = `
SELECT ?item ?itemLabel ?instagram ?twitter ?facebook ?site ?foto ?nascimento ?profissao ?idCamara ?idSenado WHERE {
  BIND(wd:${wikidataId} AS ?item)
  ${OPTIONAL_PROPS}
}
LIMIT 1
`
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`
  const resp = await fetchJSON<SparqlResponse>(url, HEADERS, 3, 20000)
  const bindings = resp?.results?.bindings ?? []
  return bindings.length > 0 ? bindings[0] : null
}

// RC2 fix: get QID from Wikipedia page (most reliable, avoids homonym contamination)
async function getWikidataIdFromWikipedia(wikipediaTitle: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    titles: wikipediaTitle,
    prop: "pageprops",
    ppprop: "wikibase_item",
    format: "json",
    origin: "*",
  })

  try {
    const url = `https://pt.wikipedia.org/w/api.php?${params}`
    const json = await fetchJSON<{ query: { pages: Record<string, { pageprops?: { wikibase_item?: string }; missing?: string }> } }>(url, {}, 3, 10000)
    const page = Object.values(json.query?.pages ?? {})[0]
    if (!page || page.missing !== undefined) return null
    return page.pageprops?.wikibase_item ?? null
  } catch (err) {
    warn("wikidata", `  getWikidataIdFromWikipedia(${wikipediaTitle}): ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

export async function ingestWikidata(): Promise<IngestResult[]> {
  const candidatos = loadCandidatos()
  const results: IngestResult[] = []

  for (const cand of candidatos) {
    const result: IngestResult = {
      source: "wikidata",
      candidato: cand.slug,
      tables_updated: [],
      rows_upserted: 0,
      errors: [],
      duration_ms: 0,
    }
    const start = Date.now()

    log("wikidata", `Processando ${cand.slug} (busca: "${cand.nome_urna}")`)

    try {
      const candidatoId = await resolveCandidatoId(cand.slug)
      if (!candidatoId) {
        result.errors.push(`Candidato ${cand.slug} nao encontrado no Supabase`)
        warn("wikidata", `  ${cand.slug}: nao encontrado no banco`)
        result.duration_ms = Date.now() - start
        results.push(result)
        await sleep(1000)
        continue
      }

      // Busca dados atuais do candidato para merge (e wikidata_id se ja existir)
      const { data: dbCand } = await supabase
        .from("candidatos")
        .select("redes_sociais, wikidata_id, foto_url, data_nascimento, profissao_declarada")
        .eq("id", candidatoId)
        .single()

      // RC2 fix: priority order for QID resolution:
      // 1. Existing wikidata_id in DB (trusted)
      // 2. Wikipedia page QID via pageprops (reliable, avoids homonym)
      // 3. Skip (name search removed — too prone to homonym contamination)
      let binding: SparqlBinding | null = null
      if (dbCand?.wikidata_id) {
        log("wikidata", `  ${cand.slug}: query por ID (${dbCand.wikidata_id})`)
        binding = await queryWikidataById(dbCand.wikidata_id)
      } else if (cand.wikipedia_title) {
        const qid = await getWikidataIdFromWikipedia(cand.wikipedia_title)
        if (qid) {
          log("wikidata", `  ${cand.slug}: QID via Wikipedia: ${qid}`)
          binding = await queryWikidataById(qid)
        } else {
          warn("wikidata", `  ${cand.slug}: Wikipedia page sem wikidata_id`)
        }
      } else {
        warn("wikidata", `  ${cand.slug}: sem wikidata_id e sem wikipedia_title, pulando`)
      }

      if (!binding) {
        warn("wikidata", `  ${cand.slug}: nao encontrado no Wikidata`)
        result.duration_ms = Date.now() - start
        results.push(result)
        await sleep(1000)
        continue
      }

      const updates: Record<string, unknown> = {}

      // Wikidata ID
      const wikidataId = binding.item?.value.split("/").pop() ?? null
      if (wikidataId && !dbCand?.wikidata_id) {
        updates.wikidata_id = wikidataId
      }

      // Foto URL (so se nao tiver)
      if (binding.foto?.value && !dbCand?.foto_url) {
        updates.foto_url = binding.foto.value
      }

      // Data de nascimento (so se nao tiver)
      if (binding.nascimento?.value && !dbCand?.data_nascimento) {
        // Wikidata retorna ISO 8601: "+1970-01-01T00:00:00Z"
        const rawDate = binding.nascimento.value.replace(/^\+/, "").split("T")[0]
        updates.data_nascimento = rawDate
      }

      // Profissao declarada (so se nao tiver)
      if (binding.profissao?.value && !dbCand?.profissao_declarada) {
        // Wikidata retorna URL da entidade, nao o label. Guardamos o ID como referencia.
        const profissaoId = binding.profissao.value.split("/").pop() ?? null
        if (profissaoId) updates.profissao_declarada = profissaoId
      }

      // Redes sociais: merge preservando o que ja existe
      const redesAtual: RedesSociais = (dbCand?.redes_sociais as RedesSociais) ?? {}
      const instagram = binding.instagram?.value ?? null
      const twitter = binding.twitter?.value ?? null
      const facebook = binding.facebook?.value ?? null
      const site = binding.site?.value ?? null

      const redesUpdate: RedesSociais = {
        ...redesAtual,
        ...(instagram
          ? {
              instagram: {
                username: instagram,
                url: `https://instagram.com/${instagram}`,
                followers: redesAtual.instagram?.followers ?? null,
              },
            }
          : {}),
        ...(twitter ? { twitter } : {}),
        ...(facebook ? { facebook } : {}),
        ...(site ? { site_oficial: site } : {}),
      }

      // So atualiza redes se mudou algo
      const redesMudou = JSON.stringify(redesAtual) !== JSON.stringify(redesUpdate)
      if (redesMudou) {
        updates.redes_sociais = redesUpdate
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from("candidatos")
          .update(updates)
          .eq("id", candidatoId)

        if (updateError) {
          result.errors.push(updateError.message)
          warn("wikidata", `  ${cand.slug}: erro ao atualizar: ${updateError.message}`)
        } else {
          result.tables_updated.push("candidatos")
          result.rows_upserted++
          log("wikidata", `  ${cand.slug}: atualizado (wikidata_id: ${wikidataId}, campos: ${Object.keys(updates).join(", ")})`)
        }
      } else {
        log("wikidata", `  ${cand.slug}: sem alteracoes necessarias`)
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
      warn("wikidata", `  ${cand.slug}: ${err instanceof Error ? err.message : String(err)}`)
    }

    result.duration_ms = Date.now() - start
    results.push(result)

    // Rate limit: Wikidata pede 1s entre queries
    await sleep(1000)
  }

  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestWikidata().then((r) => console.log(JSON.stringify(r, null, 2)))
}
