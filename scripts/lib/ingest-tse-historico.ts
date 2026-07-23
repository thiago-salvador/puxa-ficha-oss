import { existsSync, mkdirSync, createWriteStream, readdirSync, rmSync } from "fs"
import { resolve } from "path"
import { execSync } from "child_process"
import { supabase } from "./supabase"
import { fixCandidatePartyTimelineConsistency } from "../fix-party-timeline-consistency"
import { resolveCandidatoId } from "./helpers-db"
import { loadCandidatos, parseCSV } from "./helpers"
import { log, warn, error } from "./logger"
import { resolveCanonicalParty } from "./party-canonical"
import {
  canonicalizePartyTimelineLabel,
  deriveConsistentPartyTimelineRow,
  findLatestKnownPartyBefore,
  isTseObservedPartyChangeContext,
} from "./party-timeline-consistency"
import type { IngestResult, CandidatoConfig } from "./types"
import { createTSEResolver, shouldSkipWeakMatchForAno } from "./tse-resolver"
import { canonicalCargo } from "./cargo-utils"
import { sanitizeTemplateText } from "./ptbr-sanitize"
import { canonicalizeEstadoForStorage } from "@/lib/br-uf"

const DATA_DIR = resolve(process.cwd(), "data/tse-historico")
// Eleicoes gerais (federais/estaduais): anos pares divisíveis por 4 (exceto 2000s)
// Eleicoes municipais: anos pares NÃO divisíveis por 4
// TSE tem dados desde 1994. Incluímos todas para cobertura máxima.
const ANOS = [
  1994, 1996, 1998, 2000, 2002, 2004, 2006, 2008,
  2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024,
]

const CARGO_MAP: Record<string, string> = {
  PRESIDENTE: "Presidente",
  "VICE-PRESIDENTE": "Vice-Presidente",
  GOVERNADOR: "Governador",
  "VICE-GOVERNADOR": "Vice-Governador",
  SENADOR: "Senador",
  "DEPUTADO FEDERAL": "Deputado Federal",
  "DEPUTADO ESTADUAL": "Deputado Estadual",
  "DEPUTADO DISTRITAL": "Deputado Distrital",
  PREFEITO: "Prefeito",
  "VICE-PREFEITO": "Vice-Prefeito",
  VEREADOR: "Vereador",
  "1O SUPLENTE SENADOR": "1o Suplente Senador",
  "2O SUPLENTE SENADOR": "2o Suplente Senador",
  "1º SUPLENTE": "1o Suplente Senador",
  "2º SUPLENTE": "2o Suplente Senador",
}

function normalizeCargo(raw: string): string {
  const upper = raw.trim().toUpperCase()
  return CARGO_MAP[upper] ?? raw.trim()
}

function normalizePartySigla(value: string): string {
  if (!value) return ""
  const canonical = resolveCanonicalParty(value)
  return canonical?.sigla ?? value.trim().toUpperCase()
}

function parseEleitoStatus(dsSitTotTurno: string): { eleito: boolean; descricao: string } {
  const upper = (dsSitTotTurno || "").trim().toUpperCase()
  // "NÃO ELEITO" contains "ELEITO" — must check negatives first
  const naoEleitoTerms = ["NAO ELEITO", "NÃO ELEITO", "NULO", "#NULO#", "INDEFERIDO", "RENÚNCIA", "RENUNCIA", "CASSADO", "FALECIDO", "2º TURNO", "2O TURNO", "SUPLENTE"]
  if (!upper || naoEleitoTerms.some((t) => upper.includes(t))) {
    return { eleito: false, descricao: dsSitTotTurno.trim() || "Resultado não informado" }
  }
  const eleitoTerms = ["ELEITO", "ELEITO POR QP", "ELEITO POR MEDIA", "MEDIA"]
  const isEleito = eleitoTerms.some((t) => upper.includes(t))
  return { eleito: isEleito, descricao: dsSitTotTurno.trim() || "Resultado não informado" }
}

/** Não persistir em historico (decisão editorial): sem pleito válido ou registro cassado/falecido. */
function shouldOmitFromHistoricoDescricao(descricao: string): boolean {
  const u = descricao.toUpperCase()
  return (
    u.includes("INDEFERIDO") ||
    u.includes("#NULO#") ||
    u.includes("RENÚNCIA") ||
    u.includes("RENUNCIA") ||
    u.includes("CASSADO") ||
    u.includes("FALECIDO")
  )
}

interface CandidacyRecord {
  slug: string
  ano: number
  cargo: string
  partido: string
  estado: string
  situacao_resultado: string
  eleito: boolean
  match_method: string
}

async function downloadFile(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) {
    log("tse-historico", `  Cache hit: ${dest}`)
    return true
  }

  log("tse-historico", `  Baixando: ${url}`)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      warn("tse-historico", `  HTTP ${res.status} para ${url}`)
      return false
    }

    const fileStream = createWriteStream(dest)
    const reader = res.body?.getReader()
    if (!reader) return false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fileStream.write(value)
    }
    fileStream.end()

    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", resolve)
      fileStream.on("error", reject)
    })

    return true
  } catch (err) {
    warn("tse-historico", `  Falha no download: ${err}`)
    return false
  }
}

function extractZip(zipPath: string, extractDir: string) {
  mkdirSync(extractDir, { recursive: true })
  execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: "pipe" })
}

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true })
    log("tse-historico", `  Cleanup: ${dir}`)
  } catch {
    warn("tse-historico", `  Nao conseguiu limpar: ${dir}`)
  }
}

function cleanupFile(filePath: string) {
  try {
    rmSync(filePath, { force: true })
    log("tse-historico", `  Cleanup: ${filePath}`)
  } catch {
    warn("tse-historico", `  Nao conseguiu limpar: ${filePath}`)
  }
}

function findCSVs(dir: string): string[] {
  try {
    const files = readdirSync(dir) as string[]
    return files
      .filter((f: string) => f.endsWith(".csv") && f.startsWith("consulta_cand_"))
      .map((f: string) => resolve(dir, f))
  } catch {
    return []
  }
}

/**
 * Processa CSVs de um ano, coletando candidaturas de todos os candidatos do projeto.
 * Diferente do ingest-tse-situacao que guarda so o match mais recente,
 * aqui guardamos TODOS os matches (multiplos por candidato, um por ano).
 */
async function processAno(
  ano: number,
  candidatos: CandidatoConfig[]
): Promise<{ records: CandidacyRecord[]; success: boolean }> {
  const zipUrl = `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ano}.zip`
  const zipPath = resolve(DATA_DIR, `consulta_cand_${ano}.zip`)
  const extractDir = resolve(DATA_DIR, `consulta_cand_${ano}`)

  log("tse-historico", `=== Processando ano ${ano} ===`)

  const ok = await downloadFile(zipUrl, zipPath)
  if (!ok) {
    return { records: [], success: false }
  }

  try {
    extractZip(zipPath, extractDir)
  } catch (err) {
    error("tse-historico", `Falha ao extrair ZIP ${ano}: ${err}`)
    cleanupFile(zipPath)
    return { records: [], success: false }
  }

  const csvPaths = findCSVs(extractDir)
  if (csvPaths.length === 0) {
    warn("tse-historico", `Nenhum CSV encontrado no ZIP ${ano}`)
    cleanupDir(extractDir)
    cleanupFile(zipPath)
    return { records: [], success: false }
  }

  log("tse-historico", `  Parseando ${csvPaths.length} arquivo(s) CSV do ano ${ano}`)
  const resolver = await createTSEResolver(candidatos, ano)

  // Coleta todas as candidaturas encontradas neste ano
  // Usa Map para deduplicar por slug+cargo, preferindo resultado definitivo (turno 2)
  const bestRecord = new Map<string, CandidacyRecord>()

  for (const csvPath of csvPaths) {
    await parseCSV(csvPath, (row) => {
      const match = resolver.resolveRow(row)
      if (!match) return
      if (shouldSkipWeakMatchForAno(ano, match.method)) return

      const cargo = normalizeCargo(row.DS_CARGO || "")
      if (!cargo) return

      const dedupeKey = `${match.slug}|${cargo}`
      const turno = parseInt(row.NR_TURNO || "1", 10)
      const partido = normalizePartySigla(row.SG_PARTIDO || "")
      const estado = canonicalizeEstadoForStorage(row.SG_UF) ?? ""
      const resultado = parseEleitoStatus(row.DS_SIT_TOT_TURNO || "")

      const candidate: CandidacyRecord = {
        slug: match.slug,
        ano,
        cargo,
        partido,
        estado,
        situacao_resultado: resultado.descricao,
        eleito: resultado.eleito,
        match_method: match.method,
      }

      const existing = bestRecord.get(dedupeKey)
      if (!existing) {
        bestRecord.set(dedupeKey, candidate)
      } else if (turno > 1) {
        // Turno 2 tem resultado definitivo — sempre substitui turno 1
        bestRecord.set(dedupeKey, candidate)
      }
    })
  }

  cleanupDir(extractDir)
  cleanupFile(zipPath)

  const records = [...bestRecord.values()]

  log(
    "tse-historico",
    `  Stats ${ano}: sq=${resolver.stats.sqPreloaded}, cpf=${resolver.stats.cpf}, nome-unico=${resolver.stats.nameUnique}, nome-uf=${resolver.stats.nameUf}, ambiguo=${resolver.stats.ambiguous}, candidaturas=${records.length}`
  )
  if (resolver.ambiguousSlugs.length > 0) {
    warn("tse-historico", `  Ambiguos ${ano}: ${resolver.ambiguousSlugs.join(", ")}`)
  }

  return { records, success: true }
}

// Suplentes de senador nao sao cargos independentes — agrupar com Senador
const SKIP_SUPLENTE_CARGOS = new Set([
  "1o Suplente Senador",
  "2o Suplente Senador",
])

export async function ingestTSEHistorico(): Promise<IngestResult[]> {
  const candidatos = loadCandidatos()
  mkdirSync(DATA_DIR, { recursive: true })

  // Coleta candidaturas de todos os anos
  const allRecords: CandidacyRecord[] = []

  for (const ano of ANOS) {
    const { records, success } = await processAno(ano, candidatos)
    if (success) {
      allRecords.push(...records)
    }
  }

  log("tse-historico", `Total de candidaturas encontradas: ${allRecords.length}`)

  // Agrupa por candidato
  const bySlug = new Map<string, CandidacyRecord[]>()
  for (const record of allRecords) {
    const existing = bySlug.get(record.slug) ?? []
    existing.push(record)
    bySlug.set(record.slug, existing)
  }

  log("tse-historico", `Candidatos com candidaturas: ${bySlug.size}`)

  // Persiste no banco
  const results: IngestResult[] = []

  for (const cand of candidatos) {
    const records = bySlug.get(cand.slug)
    if (!records || records.length === 0) {
      continue
    }

    const result: IngestResult = {
      source: "tse-historico",
      candidato: cand.slug,
      tables_updated: [],
      rows_upserted: 0,
      errors: [],
      duration_ms: 0,
    }

    const start = Date.now()

    try {
      const candidatoId = await resolveCandidatoId(cand.slug)
      if (!candidatoId) {
        result.errors.push("Candidato nao encontrado no Supabase")
        result.duration_ms = Date.now() - start
        results.push(result)
        continue
      }

      for (const record of records) {
        // Pula suplentes de senador — nao sao cargos independentes
        if (SKIP_SUPLENTE_CARGOS.has(record.cargo)) continue

        if (shouldOmitFromHistoricoDescricao(record.situacao_resultado)) {
          log("tse-historico", `  ${cand.slug}: omitido historico ${record.cargo} ${record.ano} — ${record.situacao_resultado}`)
          continue
        }

        const eleitoPor = record.eleito ? "voto direto" : null
        const cargoCanonico = canonicalCargo(record.cargo)

        // Upsert por (candidato, cargo canônico, ano) — evita Presidente vs Presidente da República duplicado
        const { data: existingRows } = await supabase
          .from("historico_politico")
          .select("id, observacoes, periodo_fim")
          .eq("candidato_id", candidatoId)
          .eq("cargo_canonico", cargoCanonico)
          .eq("periodo_inicio", record.ano)
          .limit(1)
        const existing = existingRows?.[0]

        const observacoes = sanitizeTemplateText(record.eleito
          ? `${record.situacao_resultado} (TSE ${record.ano})`
          : `Candidatura: ${record.situacao_resultado} (TSE ${record.ano})`)

        const row = {
          candidato_id: candidatoId,
          cargo: record.cargo,
          cargo_canonico: cargoCanonico,
          tipo_evento: record.eleito ? "mandato" : "candidatura",
          periodo_inicio: record.ano,
          periodo_fim: record.eleito ? null : record.ano,
          partido: record.partido,
          estado: record.estado || cand.estado || null,
          eleito_por: eleitoPor,
          observacoes,
          proveniencia: "tse" as const,
        }

        if (existing) {
          const updateRow = {
            ...row,
            // Nao reverter mandato ja fechado: para eleito, `row.periodo_fim` e null,
            // e um re-ingest cego apagava o periodo_fim que o backfill (ou curadoria)
            // preencheu, reintroduzindo os "cargos sobrepostos" de 2026-04-10
            // (review 2026-06-09). COALESCE preserva o valor existente.
            periodo_fim: row.periodo_fim ?? existing.periodo_fim ?? null,
          }
          const { error: updateErr } = await supabase
            .from("historico_politico")
            .update(updateRow)
            .eq("id", existing.id)

          if (updateErr) {
            result.errors.push(`Erro ao atualizar historico ${record.cargo} ${record.ano}: ${updateErr.message}`)
            continue
          }
        } else {
          const { error: insertErr } = await supabase
            .from("historico_politico")
            .insert(row)

          if (insertErr) {
            result.errors.push(`Erro ao inserir historico ${record.cargo} ${record.ano}: ${insertErr.message}`)
            continue
          }
        }

        result.rows_upserted++
        if (!result.tables_updated.includes("historico_politico")) {
          result.tables_updated.push("historico_politico")
        }

        log(
          "tse-historico",
          `  ${cand.slug}: ${record.cargo} ${record.ano} ${record.partido} — ${record.situacao_resultado}`
        )
      }

      // Complementa mudancas_partido com dados de candidatura
      // se ha partido diferente entre eleicoes e nao existe registro correspondente
      const sorted = [...records]
        .filter((r) => r.partido && !SKIP_SUPLENTE_CARGOS.has(r.cargo))
        .sort((a, b) => a.ano - b.ano)

      const { data: existingMudancas, error: existingMudancasError } = await supabase
        .from("mudancas_partido")
        .select("id, partido_anterior, partido_novo, ano, data_mudanca, contexto")
        .eq("candidato_id", candidatoId)

      if (existingMudancasError) {
        result.errors.push(`Erro ao carregar mudancas_partido existentes: ${existingMudancasError.message}`)
        result.duration_ms = Date.now() - start
        results.push(result)
        continue
      }

      const knownMudancas = [...(existingMudancas ?? [])]

      let previousParty: string | null = null

      for (const record of sorted) {
        if (!record.partido) continue

        if (previousParty === null) {
          previousParty = record.partido
          continue
        }

        if (previousParty === record.partido) {
          previousParty = record.partido
          continue
        }

        const contexto = sanitizeTemplateText(`Mudança observada entre eleições TSE (${record.ano})`)
        const latestKnownParty = findLatestKnownPartyBefore(knownMudancas, {
          id: `observed-${cand.slug}-${record.ano}-${record.partido}`,
          ano: record.ano,
          data_mudanca: null,
        })
        const canonicalObservedParty = canonicalizePartyTimelineLabel(record.partido)

        if (latestKnownParty && canonicalObservedParty && latestKnownParty === canonicalObservedParty) {
          previousParty = record.partido
          continue
        }

        const inferred = deriveConsistentPartyTimelineRow(
          {
            id: `observed-${cand.slug}-${record.ano}-${record.partido}`,
            partido_anterior: previousParty,
            partido_novo: record.partido,
            ano: record.ano,
            data_mudanca: null,
            contexto,
          },
          knownMudancas
        )

        if (!inferred.partido_novo) {
          previousParty = record.partido
          continue
        }

        if (inferred.partido_anterior && inferred.partido_anterior === inferred.partido_novo) {
          previousParty = record.partido
          continue
        }

        const existingMudanca = knownMudancas.find(
          (row) =>
            row.ano === record.ano &&
            canonicalizePartyTimelineLabel(row.partido_novo) === inferred.partido_novo
        )

        if (!existingMudanca) {
          const { data: insertedMudanca, error: insertErr } = await supabase
            .from("mudancas_partido")
            .insert({
              candidato_id: candidatoId,
              partido_anterior: inferred.partido_anterior,
              partido_novo: inferred.partido_novo,
              ano: record.ano,
              contexto,
            })
            .select("id, partido_anterior, partido_novo, ano, data_mudanca, contexto")
            .single()

          if (insertErr) {
            result.errors.push(`Erro ao inserir mudanca de partido ${record.ano}: ${insertErr.message}`)
          } else {
            knownMudancas.push(insertedMudanca)
            result.rows_upserted++
            if (!result.tables_updated.includes("mudancas_partido")) {
              result.tables_updated.push("mudancas_partido")
            }

            log(
              "tse-historico",
              `  ${cand.slug}: mudanca de partido ${inferred.partido_anterior} -> ${inferred.partido_novo} (${record.ano})`
            )
          }
        } else if (isTseObservedPartyChangeContext(existingMudanca.contexto)) {
          const needsUpdate =
            existingMudanca.partido_anterior !== inferred.partido_anterior ||
            existingMudanca.partido_novo !== inferred.partido_novo

          if (needsUpdate) {
            const { error: updateErr } = await supabase
              .from("mudancas_partido")
              .update({
                partido_anterior: inferred.partido_anterior,
                partido_novo: inferred.partido_novo,
                contexto,
              })
              .eq("id", existingMudanca.id)

            if (updateErr) {
              result.errors.push(`Erro ao atualizar mudanca de partido ${record.ano}: ${updateErr.message}`)
            } else {
              existingMudanca.partido_anterior = inferred.partido_anterior
              existingMudanca.partido_novo = inferred.partido_novo
              existingMudanca.contexto = contexto
              result.rows_upserted++
              if (!result.tables_updated.includes("mudancas_partido")) {
                result.tables_updated.push("mudancas_partido")
              }

              log(
                "tse-historico",
                `  ${cand.slug}: mudanca de partido ajustada para ${inferred.partido_anterior} -> ${inferred.partido_novo} (${record.ano})`
              )
            }
          }
        }

        previousParty = record.partido
      }

      const repairedMudancas = await fixCandidatePartyTimelineConsistency(candidatoId, true, {
        kind: "all",
      })
      if (repairedMudancas.length > 0) {
        result.rows_upserted += repairedMudancas.length
        if (!result.tables_updated.includes("mudancas_partido")) {
          result.tables_updated.push("mudancas_partido")
        }

        for (const repair of repairedMudancas) {
            log(
                "tse-historico",
            `  ${cand.slug}: timeline corrigida [${repair.category}] ${repair.before.partido_anterior} -> ${repair.before.partido_novo} => ${repair.after.partido_anterior} -> ${repair.after.partido_novo}`
            )
        }
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }

    result.duration_ms = Date.now() - start
    results.push(result)
  }

  // Cleanup data dir se vazio
  try {
    const remaining = (readdirSync(DATA_DIR) as string[]).filter((f) => f !== ".DS_Store")
    if (remaining.length === 0) {
      cleanupDir(DATA_DIR)
    }
  } catch {
    // ignore
  }

  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestTSEHistorico().then((r) => console.log(JSON.stringify(r, null, 2)))
}
