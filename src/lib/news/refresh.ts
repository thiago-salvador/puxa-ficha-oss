/**
 * Refresh incremental de noticias por candidato a partir do Google News RSS.
 *
 * Roda sobre um SUBCONJUNTO de candidatos (passado pela rota /api/news/refresh,
 * que fatia o universo em lotes pequenos e se reencadeia via after()). Mantem o
 * comportamento provado do pipeline manual (scripts/lib/ingest-google-news.ts):
 * fetch sequencial com pausa entre candidatos, upsert idempotente com
 * ignoreDuplicates sobre UNIQUE(candidato_id, url). Sem deletes, sem updates de
 * linha existente: so insere noticia nova.
 *
 * Tudo via deps injetaveis (upsert, fetch, sleep) para manter o modulo puro de
 * runtime e testavel sem tocar Supabase nem rede.
 */
import {
  buildGoogleNewsSearchUrl,
  parseGoogleNewsRss,
} from "@/lib/news/google-news"

export interface NewsCandidato {
  id: string
  slug: string
  nome_urna: string
  cargo_disputado: string | null
}

export interface NoticiaRow {
  candidato_id: string
  titulo: string
  fonte: string
  url: string
  data_publicacao: string
}

export interface NewsRefreshSummary {
  processed: number
  withNews: number
  rowsUpserted: number
  errors: Array<{ slug: string; error: string }>
}

export interface NewsRefreshDeps {
  upsertNoticias: (rows: NoticiaRow[]) => Promise<{ error: string | null }>
  fetchImpl: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => Date
  sleepMs: number
  timeoutMs: number
  newsLimit: number
}

const DEFAULT_NEWS_SLEEP_MS = 1500
const DEFAULT_NEWS_TIMEOUT_MS = 8000
const DEFAULT_NEWS_LIMIT = 20

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Processa o lote de candidatos em serie. Falha de um candidato (HTTP, timeout,
 * upsert) e nao-fatal: registra em `errors` e segue. A pausa `sleepMs` roda em
 * todos os ramos (sucesso, sem-noticia, erro) para nao martelar o Google News.
 */
export async function refreshCandidatosNews(
  candidatos: NewsCandidato[],
  deps: NewsRefreshDeps,
): Promise<NewsRefreshSummary> {
  const summary: NewsRefreshSummary = {
    processed: 0,
    withNews: 0,
    rowsUpserted: 0,
    errors: [],
  }

  for (let index = 0; index < candidatos.length; index += 1) {
    const cand = candidatos[index]
    summary.processed += 1

    const url = buildGoogleNewsSearchUrl(cand.nome_urna, cand.cargo_disputado)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs)

    try {
      const res = await deps.fetchImpl(url, { signal: controller.signal })
      clearTimeout(timer)

      if (!res.ok) {
        summary.errors.push({ slug: cand.slug, error: `HTTP ${res.status}` })
        continue
      }

      const xml = await res.text()
      const { items } = parseGoogleNewsRss(xml, deps.now)
      const newsItems = items.slice(0, deps.newsLimit)

      if (newsItems.length === 0) {
        continue
      }

      const rows: NoticiaRow[] = newsItems.map((item) => ({
        candidato_id: cand.id,
        titulo: item.titulo,
        fonte: item.fonte,
        url: item.url,
        data_publicacao: item.data_publicacao,
      }))

      const { error } = await deps.upsertNoticias(rows)
      if (error) {
        summary.errors.push({ slug: cand.slug, error })
        continue
      }

      summary.withNews += 1
      summary.rowsUpserted += rows.length
    } catch (err) {
      clearTimeout(timer)
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "timeout"
          : err instanceof Error
            ? err.message
            : String(err)
      summary.errors.push({ slug: cand.slug, error: message })
    } finally {
      if (index < candidatos.length - 1) {
        await deps.sleep(deps.sleepMs)
      }
    }
  }

  return summary
}

export function defaultNewsRefreshDeps(
  upsertNoticias: NewsRefreshDeps["upsertNoticias"],
): NewsRefreshDeps {
  return {
    upsertNoticias,
    fetchImpl: fetch,
    sleep: defaultSleep,
    now: () => new Date(),
    sleepMs: DEFAULT_NEWS_SLEEP_MS,
    timeoutMs: DEFAULT_NEWS_TIMEOUT_MS,
    newsLimit: DEFAULT_NEWS_LIMIT,
  }
}
