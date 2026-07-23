import { supabase } from "./supabase"
import { resolveCandidatoId } from "./helpers-db"
import { loadCandidatos, sleep } from "./helpers"
import { log, warn } from "./logger"
import type { IngestResult } from "./types"
import {
  buildGoogleNewsSearchUrl,
  parseGoogleNewsRss,
} from "../../src/lib/news/google-news"

export async function ingestGoogleNews(): Promise<IngestResult[]> {
  const candidatos = loadCandidatos()
  const results: IngestResult[] = []

  for (const cand of candidatos) {
    const start = Date.now()
    const result: IngestResult = {
      source: "google-news",
      candidato: cand.slug,
      tables_updated: [],
      rows_upserted: 0,
      errors: [],
      duration_ms: 0,
    }

    log("google-news", `Processando ${cand.slug}`)

    try {
      const candidatoId = await resolveCandidatoId(cand.slug)
      if (!candidatoId) {
        result.errors.push("Candidato nao encontrado no Supabase")
        result.duration_ms = Date.now() - start
        results.push(result)
        continue
      }

      const url = buildGoogleNewsSearchUrl(cand.nome_urna, cand.cargo_disputado)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)

      try {
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timer)

        if (!res.ok) {
          warn("google-news", `  ${cand.slug}: HTTP ${res.status}`)
          result.duration_ms = Date.now() - start
          results.push(result)
          await sleep(2000)
          continue
        }

        const xml = await res.text()
        const { items, discardedUrls } = parseGoogleNewsRss(xml)
        const newsItems = items.slice(0, 20)

        if (discardedUrls > 0) {
          warn("google-news", `  ${cand.slug}: ${discardedUrls} URL(s) descartada(s) por esquema invalido`)
        }

        if (newsItems.length === 0) {
          log("google-news", `  ${cand.slug}: nenhuma noticia`)
          result.duration_ms = Date.now() - start
          results.push(result)
          await sleep(2000)
          continue
        }

        const rows = newsItems.map((item) => ({
          candidato_id: candidatoId,
          titulo: item.titulo,
          fonte: item.fonte,
          url: item.url,
          data_publicacao: item.data_publicacao,
        }))

        const { error: upsertErr } = await supabase
          .from("noticias_candidato")
          .upsert(rows, {
            onConflict: "candidato_id,url",
            ignoreDuplicates: true,
          })

        if (upsertErr) {
          result.errors.push(upsertErr.message)
        } else {
          result.tables_updated.push("noticias_candidato")
          result.rows_upserted = newsItems.length
          log(
            "google-news",
            `  ${cand.slug}: ${newsItems.length} noticias`
          )
        }
      } catch (err) {
        clearTimeout(timer)
        if (err instanceof Error && err.name === "AbortError") {
          warn("google-news", `  ${cand.slug}: timeout`)
        } else {
          result.errors.push(
            err instanceof Error ? err.message : String(err)
          )
        }
      }
    } catch (err) {
      result.errors.push(
        err instanceof Error ? err.message : String(err)
      )
    }

    result.duration_ms = Date.now() - start
    results.push(result)
    await sleep(2000)
  }

  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestGoogleNews().then((r) => {
    const total = r.reduce((s, x) => s + x.rows_upserted, 0)
    const errors = r.reduce((s, x) => s + x.errors.length, 0)
    console.log(`\nGoogle News: ${total} noticias, ${errors} erros`)
  })
}
