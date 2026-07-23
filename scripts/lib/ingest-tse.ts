import { existsSync, mkdirSync, createWriteStream, readdirSync, rmSync, type Dirent } from "fs"
import { resolve, sep } from "path"
import { execSync } from "child_process"
import { supabase } from "./supabase"
import { resolveCandidatoId } from "./helpers-db"
import { loadCandidatos, parseCSV, sleep } from "./helpers"
import { log, warn, error } from "./logger"
import type { IngestResult, CandidatoConfig } from "./types"
import {
  createTSEResolver,
  getResolveMethodPriority,
  shouldSkipWeakMatchForAno,
  type ResolveMethod,
  type TSEResolver,
} from "./tse-resolver"
import { extractOptionalDonorIdsFromTseRow } from "../../src/lib/financiamento-doador-identifiers"
import {
  normalizeDoadorTipoWithIdentifiers,
  normalizeMaioresDoadoresForStorage,
  sanitizeMaioresDoadoresForPublic,
} from "../../src/lib/financiamento-public"
import { maskDocumentLikeSequences } from "../../src/lib/public-profile-dto"
import { dedupeTsePatrimonioRows } from "../../src/lib/tse-patrimonio-dedupe"
import { financiamentoReceitasZipUrls } from "./tse-financiamento-receitas-urls"
import { normalizeFinanciamentoReceitaRow } from "./financiamento-receita-legacy-row"

const DATA_DIR = resolve(process.cwd(), "data/tse")
const DEFAULT_ANOS = [2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024]
const KEEP_TSE_DOWNLOADS = process.env.PF_KEEP_TSE_DOWNLOADS === "1"

function getGovernorUFs(candidatos: CandidatoConfig[], slugAllowlist?: Set<string> | null): string[] {
  return [
    ...new Set(
      candidatos
        .filter(
          (candidato) =>
            candidato.cargo_disputado === "Governador" &&
            candidato.estado &&
            (!slugAllowlist || slugAllowlist.has(candidato.slug))
        )
        .map((candidato) => candidato.estado!.toUpperCase())
    ),
  ]
}

function parseBRL(value: string, context: string): number {
  if (!value || value === "#NULO#" || value === "#NE#" || value === "-1") return 0
  const parsed = parseFloat(value.replace(/\./g, "").replace(",", "."))
  if (Number.isNaN(parsed)) {
    warn("tse", `  Valor monetario invalido em ${context}: "${value}"`)
    return 0
  }
  return parsed
}

async function downloadFile(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) {
    log("tse", `  Cache hit: ${dest}`)
    return true
  }

  log("tse", `  Baixando: ${url}`)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      warn("tse", `  HTTP ${res.status} para ${url}`)
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
    warn("tse", `  Falha no download: ${err}`)
    return false
  }
}

function extractZip(zipPath: string, extractDir: string, extraPatterns?: string[]) {
  mkdirSync(extractDir, { recursive: true })
  // Extract BR/BRASIL files (national-level candidates) + any extra patterns (e.g. UF files for governors)
  const patterns = ["'*_BR*'", "'*_BRASIL*'", ...(extraPatterns || []).map((p) => `'*_${p}*'`)]
  try {
    execSync(`unzip -o "${zipPath}" ${patterns.join(" ")} -d "${extractDir}"`, { stdio: "pipe" })
  } catch {
    // `unzip` exits non-zero when one optional glob has no match even if the
    // requested BR/UF files were extracted. Preserve that bounded extraction.
    if (readdirSync(extractDir).length > 0) return
    // Fallback: extract everything if pattern match fails (some ZIPs have different naming)
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: "pipe" })
  }
}

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true })
    log("tse", `  Cleanup: ${dir}`)
  } catch {
    warn("tse", `  Nao conseguiu limpar: ${dir}`)
  }
}

function cleanupFile(filePath: string) {
  try {
    rmSync(filePath, { force: true })
    log("tse", `  Cleanup: ${filePath}`)
  } catch {
    warn("tse", `  Nao conseguiu limpar: ${filePath}`)
  }
}

function cleanupDownloadedZip(filePath: string) {
  if (KEEP_TSE_DOWNLOADS) {
    log("tse", `  Cache preservado: ${filePath}`)
    return
  }

  cleanupFile(filePath)
}

function findCSVs(dir: string, pattern: string): string[] {
  try {
    const files = readdirSync(dir) as string[]
    return files
      .filter((f: string) => f.toLowerCase().includes(pattern.toLowerCase()) && f.endsWith(".csv"))
      .map((f: string) => resolve(dir, f))
  } catch {
    return []
  }
}

/** Receitas de candidatos: CSV (2018+) ou TXT legado (ex. 2010), recursivo após unzip. */
function collectReceitasCandidatoSourceFiles(rootDir: string): string[] {
  const results: string[] = []
  const walk = (dir: string) => {
    let dirents: Dirent[]
    try {
      dirents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      const p = resolve(dir, d.name)
      if (d.isDirectory()) walk(p)
      else if (d.isFile()) {
        const lower = d.name.toLowerCase()
        if (!(lower.endsWith(".csv") || lower.endsWith(".txt"))) continue
        if (lower.includes("receita") && lower.includes("candidat")) results.push(p)
      }
    }
  }
  walk(rootDir)
  return [...new Set(results)]
}

/**
 * Download and parse consulta_cand to build SQ_CANDIDATO → slug mapping.
 * The bens CSV only has SQ_CANDIDATO (no name), so we need this cross-reference.
 */
async function buildSQMap(
  ano: number,
  candidatos: CandidatoConfig[],
  resolver: TSEResolver,
  governorUFs = getGovernorUFs(candidatos)
): Promise<Map<string, CandidatoConfig>> {
  const candZip = resolve(DATA_DIR, `consulta_cand_${ano}.zip`)
  const candDir = resolve(DATA_DIR, `consulta_cand_${ano}`)
  const url = `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ano}.zip`

  const ok = await downloadFile(url, candZip)
  if (!ok) return new Map()

  extractZip(candZip, candDir, governorUFs)

  const brPaths = findCSVs(candDir, "_BR").concat(findCSVs(candDir, "_BRASIL"))
  const ufPaths = governorUFs.flatMap((uf) => findCSVs(candDir, `_${uf}`))
  const allPaths = [...brPaths, ...ufPaths].filter((v, i, a) => a.indexOf(v) === i)
  if (allPaths.length === 0) return new Map()

  const candidatosBySlug = new Map(candidatos.map((candidato) => [candidato.slug, candidato]))
  const selectedBySlug = new Map<
    string,
    { candidato: CandidatoConfig; sq: string; method: ResolveMethod; priority: number }
  >()
  const callerAmbiguousPriority = new Map<string, number>()

  for (const candidato of candidatos) {
    const sq = candidato.ids.tse_sq_candidato?.[String(ano)]?.trim()
    if (!sq) continue
    selectedBySlug.set(candidato.slug, {
      candidato,
      sq,
      method: "sq-preloaded",
      priority: getResolveMethodPriority("sq-preloaded"),
    })
  }

  for (const csvPath of allPaths) {
    await parseCSV(csvPath, (row) => {
      const sq = (row.SQ_CANDIDATO || "").trim()
      if (!sq) return

      const match = resolver.resolveRow(row)
      if (!match) return
      if (shouldSkipWeakMatchForAno(ano, match.method)) return

      const candidato = candidatosBySlug.get(match.slug)
      if (!candidato) return

      const priority = getResolveMethodPriority(match.method)
      const existing = selectedBySlug.get(match.slug)
      if (!existing) {
        selectedBySlug.set(match.slug, { candidato, sq, method: match.method, priority })
        return
      }

      if (priority > existing.priority) {
        selectedBySlug.set(match.slug, { candidato, sq, method: match.method, priority })
        callerAmbiguousPriority.delete(match.slug)
        return
      }

      if (priority < existing.priority || existing.sq === sq) {
        return
      }

      callerAmbiguousPriority.set(match.slug, priority)
    })
  }

  const sqMap = new Map<string, CandidatoConfig>()
  let preloaded = 0
  let resolved = 0

  for (const [slug, selection] of selectedBySlug) {
    if (callerAmbiguousPriority.has(slug)) continue
    sqMap.set(selection.sq, selection.candidato)
    if (selection.method === "sq-preloaded") preloaded++
    else resolved++
  }

  log("tse", `  SQ map ${ano}: ${sqMap.size} candidatos mapeados (${preloaded} preloaded, ${resolved} via resolver)`)
  if (callerAmbiguousPriority.size > 0) {
    warn("tse", `  Ambiguos SQ map ${ano}: ${[...callerAmbiguousPriority.keys()].join(", ")}`)
  }
  return sqMap
}

async function processPatrimonio(
  ano: number,
  candidatos: CandidatoConfig[],
  extractDir: string,
  sqMap: Map<string, CandidatoConfig>,
  slugAllowlist: Set<string> | null,
  options: Pick<IngestTseOptions, "dryRun" | "onPlannedRow">
): Promise<IngestResult[]> {
  const brPaths = findCSVs(extractDir, "_BR").concat(findCSVs(extractDir, "_BRASIL"))
  const governorUFs = getGovernorUFs(candidatos)
  const ufPaths = governorUFs.flatMap((uf) => findCSVs(extractDir, `_${uf}`))
  const allSourcePaths = [...brPaths, ...ufPaths]
  const csvPaths = allSourcePaths.length > 0
    ? allSourcePaths
    : findCSVs(extractDir, `bem_candidato_${ano}`).concat(findCSVs(extractDir, "bem_candidato"))
  const uniquePaths = csvPaths.filter((v, i, a) => a.indexOf(v) === i)

  if (uniquePaths.length === 0) {
    warn("tse", `  CSV de bens nao encontrado para ${ano}`)
    return []
  }

  const parsedRows: Array<{
    slug: string
    sourceKey: string
    ordem: string
    tipo: string
    descricao: string
    valor: number
  }> = []

  log("tse", `  Parseando patrimonio ${ano}: ${uniquePaths.length} arquivos CSV (BR${governorUFs.length > 0 ? " + " + governorUFs.length + " UFs" : ""})`)
  for (const csvPath of uniquePaths) {
    await parseCSV(csvPath, (row) => {
      const sq = (row.SQ_CANDIDATO || "").trim()
      const cand = sqMap.get(sq)
      if (!cand) return
      if (slugAllowlist && !slugAllowlist.has(cand.slug)) return

      const valor = parseBRL(
        row.VR_BEM_CANDIDATO || "0",
        `patrimonio ${ano} ${cand.slug}`
      )

      parsedRows.push({
        slug: cand.slug,
        sourceKey: csvPath,
        ordem: row.NR_ORDEM_BEM_CANDIDATO || "",
        tipo: row.DS_TIPO_BEM_CANDIDATO || "",
        descricao: row.DS_BEM_CANDIDATO || "",
        valor,
      })
    })
  }

  const dedupedRows = dedupeTsePatrimonioRows(parsedRows)
  if (dedupedRows.length !== parsedRows.length) {
    log(
      "tse",
      `  Patrimonio ${ano}: removidas ${parsedRows.length - dedupedRows.length} duplicatas cruzadas entre arquivos BR/UF`
    )
  }

  const aggregated = new Map<string, { bens: { tipo: string; descricao: string; valor: number }[]; total: number }>()
  for (const item of dedupedRows) {
    const existing = aggregated.get(item.slug) ?? { bens: [], total: 0 }
    existing.bens.push({
      tipo: item.tipo,
      descricao: item.descricao,
      valor: item.valor,
    })
    existing.total += item.valor
    aggregated.set(item.slug, existing)
  }

  const results: IngestResult[] = []
  for (const [slug, data] of aggregated) {
    const candidatoId = await resolveCandidatoId(slug)
    if (!candidatoId) continue

    const row = {
      candidato_id: candidatoId,
      ano_eleicao: ano,
      valor_total: Math.round(data.total * 100) / 100,
      bens: data.bens,
      fonte: "TSE",
    }

    if (options.dryRun) {
      options.onPlannedRow?.({
        table: "patrimonio",
        slug,
        row: {
          ...row,
          bens: row.bens.map((bem) => ({
            ...bem,
            descricao: maskDocumentLikeSequences(bem.descricao),
          })),
        },
      })
    } else {
      const { data: existing } = await supabase
        .from("patrimonio")
        .select("id")
        .eq("candidato_id", candidatoId)
        .eq("ano_eleicao", ano)
        .single()

      if (existing) {
        await supabase.from("patrimonio").update(row).eq("id", existing.id)
      } else {
        await supabase.from("patrimonio").insert(row)
      }
    }

    log("tse", `  ${slug}: patrimonio ${ano} — R$ ${Math.round(data.total).toLocaleString()} (${data.bens.length} bens)`)
    results.push({
      source: "tse",
      candidato: slug,
      tables_updated: ["patrimonio"],
      rows_upserted: options.dryRun ? 0 : 1,
      errors: [],
      duration_ms: 0,
    })
  }

  return results
}

async function processFinanciamento(
  ano: number,
  candidatos: CandidatoConfig[],
  extractDir: string,
  sqMap: Map<string, CandidatoConfig>,
  slugAllowlist: Set<string> | null,
  options: Pick<IngestTseOptions, "dryRun" | "onPlannedRow">
): Promise<IngestResult[]> {
  const governorUFs = getGovernorUFs(candidatos)
  const allReceiptFiles = collectReceitasCandidatoSourceFiles(extractDir)
  const lowerPath = (p: string) => p.toLowerCase()
  const brPaths = allReceiptFiles.filter((p) => {
    const lp = lowerPath(p)
    return (
      lp.includes("_br") ||
      lp.includes("_brasil") ||
      lp.includes("brasil.csv") ||
      // Legacy 2010 layout: candidato/BR/ReceitasCandidatos.txt — directory-based BR partition.
      lp.includes(`${sep}br${sep}`) ||
      lp.includes(`${sep}brasil${sep}`)
    )
  })
  const ufPaths = allReceiptFiles.filter((p) =>
    governorUFs.some((uf) => {
      const u = uf.toLowerCase()
      const lp = lowerPath(p)
      return (
        lp.includes(`_${u}.`) ||
        lp.includes(`${sep}${u}${sep}`) ||
        lp.includes(`${sep}${u.toLowerCase()}${sep}`)
      )
    })
  )
  const allSourcePaths = [...brPaths, ...ufPaths]
  const csvPaths =
    allSourcePaths.length > 0
      ? allSourcePaths
      : allReceiptFiles.length > 0
        ? allReceiptFiles
        : findCSVs(extractDir, `receitas_candidatos_${ano}`)
            .concat(findCSVs(extractDir, "receitas_candidatos"))
            .concat(findCSVs(extractDir, "receita_candidato"))
            .concat(findCSVs(extractDir, "receitascandidatos"))
  const uniquePaths = csvPaths.filter((v, i, a) => a.indexOf(v) === i)

  if (uniquePaths.length === 0) {
    warn("tse", `  Ficheiros de receitas de candidatos nao encontrados para ${ano}`)
    return []
  }

  const doadorCpfSalt = process.env.PF_DOADOR_CPF_HASH_SALT?.trim()
  const requireSaltWhenCpfPresent =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production"
  if (!doadorCpfSalt && !requireSaltWhenCpfPresent) {
    log(
      "tse",
      "  Aviso: PF_DOADOR_CPF_HASH_SALT ausente — CPF de doador no CSV nao gera cpf_hash ate configurar o salt."
    )
  }

  interface FinData {
    total: number
    fundo_partidario: number
    fundo_eleitoral: number
    pessoa_fisica: number
    recursos_proprios: number
    doadores: { nome: string; valor: number; tipo: string; cnpj?: string; cpf_hash?: string }[]
  }

  const aggregated = new Map<string, FinData>()
  // Dedup: mesma receita pode aparecer em CSV _BR e _UF; SQ_RECEITA e unico por linha TSE.
  const seenReceipts = new Set<string>()

  log(
    "tse",
    `  Parseando financiamento ${ano}: ${uniquePaths.length} ficheiros de receitas (BR${governorUFs.length > 0 ? " + " + governorUFs.length + " UFs" : ""})`
  )
  for (const csvPath of uniquePaths) {
    await parseCSV(csvPath, (raw) => {
      const row = normalizeFinanciamentoReceitaRow(raw)
      const sq = (row.SQ_CANDIDATO || "").trim()
      if (!sq) return

      const sqReceita = (row.SQ_RECEITA || "").trim()
      if (sqReceita) {
        const dedupKey = `${sq}:${sqReceita}`
        if (seenReceipts.has(dedupKey)) return
        seenReceipts.add(dedupKey)
      }

      const candidato = sqMap.get(sq)
      if (!candidato) return

      const existing = aggregated.get(candidato.slug) ?? {
        total: 0,
        fundo_partidario: 0,
        fundo_eleitoral: 0,
        pessoa_fisica: 0,
        recursos_proprios: 0,
        doadores: [],
      }

      const valor = parseBRL(
        row.VR_RECEITA || "0",
        `financiamento ${ano} ${candidato.slug}`
      )
      const origem = (row.DS_ORIGEM_RECEITA || "").toUpperCase()

      existing.total += valor

      if (origem.includes("FUNDO PARTID")) existing.fundo_partidario += valor
      else if (origem.includes("FUNDO ESPECIAL") || origem.includes("FEFC")) existing.fundo_eleitoral += valor
      else if (origem.includes("PESSOA F")) existing.pessoa_fisica += valor
      else if (origem.includes("RECURSO") && origem.includes("PROPRIO")) existing.recursos_proprios += valor

      const nomeDoador = row.NM_DOADOR || row.NM_DOADOR_RFB || ""
      const tipoDoadorInicial: FinData["doadores"][number]["tipo"] = origem.includes("PESSOA F")
        ? "PF"
        : origem.includes("FUNDO PARTID")
          ? "fundo_partidario"
          : origem.includes("FUNDO ESPECIAL") || origem.includes("FEFC")
            ? "fundo_eleitoral"
            : origem.includes("PROPRIO")
              ? "recursos_proprios"
              : "PJ"

      let donorIds: { cnpj?: string; cpf_hash?: string }
      try {
        donorIds = extractOptionalDonorIdsFromTseRow(row, doadorCpfSalt, { requireSaltWhenCpfPresent })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        error("tse", `  ${msg}`)
        throw e // não engole: interrompe o ingest (ex.: CPF no CSV em prod sem PF_DOADOR_CPF_HASH_SALT)
      }

      const doador: FinData["doadores"][number] = {
        nome: nomeDoador,
        valor,
        tipo: normalizeDoadorTipoWithIdentifiers(tipoDoadorInicial, donorIds),
      }
      if (donorIds.cnpj) doador.cnpj = donorIds.cnpj
      if (donorIds.cpf_hash) doador.cpf_hash = donorIds.cpf_hash

      existing.doadores.push(doador)

      aggregated.set(candidato.slug, existing)
    })
  }

  const results: IngestResult[] = []
  for (const [slug, data] of aggregated) {
    if (slugAllowlist && !slugAllowlist.has(slug)) continue
    const candidatoId = await resolveCandidatoId(slug)
    if (!candidatoId) continue

    // Agregar pela chave publica exibida; se IDs divergirem no mesmo nome, nao persiste um ID unico enganoso.
    const maioresDoadores = normalizeMaioresDoadoresForStorage(data.doadores)

    const row = {
      candidato_id: candidatoId,
      ano_eleicao: ano,
      total_arrecadado: Math.round(data.total * 100) / 100,
      total_fundo_partidario: Math.round(data.fundo_partidario * 100) / 100,
      total_fundo_eleitoral: Math.round(data.fundo_eleitoral * 100) / 100,
      total_pessoa_fisica: Math.round(data.pessoa_fisica * 100) / 100,
      total_recursos_proprios: Math.round(data.recursos_proprios * 100) / 100,
      maiores_doadores: maioresDoadores,
      fonte: "TSE",
    }

    if (options.dryRun) {
      options.onPlannedRow?.({
        table: "financiamento",
        slug,
        row: {
          ...row,
          maiores_doadores: sanitizeMaioresDoadoresForPublic(row.maiores_doadores),
        },
      })
    } else {
      const { data: existing } = await supabase
        .from("financiamento")
        .select("id")
        .eq("candidato_id", candidatoId)
        .eq("ano_eleicao", ano)
        .single()

      if (existing) {
        await supabase.from("financiamento").update(row).eq("id", existing.id)
      } else {
        await supabase.from("financiamento").insert(row)
      }
    }

    log("tse", `  ${slug}: financiamento ${ano} — R$ ${Math.round(data.total).toLocaleString()} (${data.doadores.length} receitas)`)
    results.push({
      source: "tse",
      candidato: slug,
      tables_updated: ["financiamento"],
      rows_upserted: options.dryRun ? 0 : 1,
      errors: [],
      duration_ms: 0,
    })
  }

  return results
}

function logResolverStats(ano: number, resolver: TSEResolver) {
  const { stats } = resolver
  log(
    "tse",
    `  Resolver ${ano}: sq-preloaded=${stats.sqPreloaded}, cpf=${stats.cpf}, name-unique=${stats.nameUnique}, name-uf=${stats.nameUf}, ambiguous=${stats.ambiguous}, no-match=${stats.noMatch}`
  )

  if (resolver.ambiguousSlugs.length > 0) {
    log("tse", `  Ambiguos ${ano}: ${resolver.ambiguousSlugs.join(", ")}`)
  }
}

export interface PlannedTseRow {
  table: "patrimonio" | "financiamento"
  slug: string
  row: Record<string, unknown>
}

export type IngestTseOptions = {
  /** Omite download/parse de patrimônio (bens) — útil para lote só `financiamento-gap`. */
  skipPatrimonio?: boolean
  /** Se definido, só persiste linhas de `patrimonio` para estes slugs. */
  patrimonioSlugAllowlist?: Set<string> | null
  /** Se definido, só persiste linhas de `financiamento` para estes slugs. */
  financiamentoSlugAllowlist?: Set<string> | null
  /** Planeja linhas a partir dos arquivos oficiais sem fazer INSERT/UPDATE. */
  dryRun?: boolean
  /** Recebe cada linha normalizada quando `dryRun` está ativo. */
  onPlannedRow?: (entry: PlannedTseRow) => void
}

export async function ingestTSE(
  anos: number[] = DEFAULT_ANOS,
  options: IngestTseOptions = {}
): Promise<IngestResult[]> {
  const candidatos = loadCandidatos()
  const allResults: IngestResult[] = []

  mkdirSync(DATA_DIR, { recursive: true })
  if (KEEP_TSE_DOWNLOADS) {
    log("tse", "Cache de downloads TSE ativo (PF_KEEP_TSE_DOWNLOADS=1)")
  }

  for (const ano of anos) {
    log("tse", `=== Processando eleicao ${ano} ===`)

    const bensZip = resolve(DATA_DIR, `bem_candidato_${ano}.zip`)
    const bensDir = resolve(DATA_DIR, `bem_${ano}`)
    const receitasDir = resolve(DATA_DIR, `receitas_${ano}`)

    const targetSlugs = new Set([
      ...(options.patrimonioSlugAllowlist ?? []),
      ...(options.financiamentoSlugAllowlist ?? []),
    ])
    const governorUFs = getGovernorUFs(candidatos, targetSlugs.size > 0 ? targetSlugs : null)
    const resolver = await createTSEResolver(candidatos, ano)

    const sqMap = await buildSQMap(ano, candidatos, resolver, governorUFs)
    cleanupDir(resolve(DATA_DIR, `consulta_cand_${ano}`))
    cleanupDownloadedZip(resolve(DATA_DIR, `consulta_cand_${ano}.zip`))

    const bensUrl = `https://cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/bem_candidato_${ano}.zip`
    if (!options.skipPatrimonio) {
      const bensOk = await downloadFile(bensUrl, bensZip)
      if (bensOk) {
        try {
          extractZip(bensZip, bensDir, governorUFs)
          const patrimonioResults = await processPatrimonio(
            ano,
            candidatos,
            bensDir,
            sqMap,
            options.patrimonioSlugAllowlist ?? null,
            options
          )
          allResults.push(...patrimonioResults)
        } catch (err) {
          error("tse", `  Erro patrimonio ${ano}: ${err}`)
        }
        cleanupDir(bensDir)
        cleanupDownloadedZip(bensZip)
      }
    } else {
      log("tse", `  Patrimonio ${ano}: ignorado (skipPatrimonio)`)
    }

    await sleep(1000)

    cleanupDir(receitasDir)
    const receitasUrls = financiamentoReceitasZipUrls(ano)
    let anyReceitasZip = false
    for (let i = 0; i < receitasUrls.length; i++) {
      const receitasUrl = receitasUrls[i]
      const pathTail = new URL(receitasUrl).pathname.split("/").pop() ?? `receitas_${i}.zip`
      const receitasZip = resolve(DATA_DIR, `receitas_${ano}_${i}_${pathTail}`)
      log("tse", `  Receitas ${ano}: baixando ${receitasUrl}`)
      const receitasOk = await downloadFile(receitasUrl, receitasZip)
      if (receitasOk) {
        anyReceitasZip = true
        try {
          extractZip(receitasZip, receitasDir, governorUFs)
        } catch (err) {
          error("tse", `  Erro ao extrair receitas ${ano} (${receitasUrl}): ${err}`)
        }
        cleanupDownloadedZip(receitasZip)
      }
    }
    if (anyReceitasZip) {
      try {
        const finResults = await processFinanciamento(
          ano,
          candidatos,
          receitasDir,
          sqMap,
          options.financiamentoSlugAllowlist ?? null,
          options
        )
        allResults.push(...finResults)
      } catch (err) {
        error("tse", `  Erro financiamento ${ano}: ${err}`)
      }
    } else {
      warn("tse", `  Receitas ${ano}: nenhum ZIP de receitas baixado (URLs: ${receitasUrls.length})`)
    }
    cleanupDir(receitasDir)

    logResolverStats(ano, resolver)
    await sleep(1000)
  }

  // Final cleanup: remove tse dir if empty
  try {
    const remaining = readdirSync(DATA_DIR).filter((f: string) => f !== ".DS_Store")
    if (remaining.length === 0) {
      cleanupDir(DATA_DIR)
    }
  } catch {
    // ignore
  }

  return allResults
}

function parseIngestTseCli(): { anos: number[]; options: IngestTseOptions } {
  const argv = process.argv.slice(2)
  const anos: number[] = []
  let skipPatrimonio = false
  let patrimonioSlugs: string[] | null = null
  let financiamentoSlugs: string[] | null = null
  let dryRun = false
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true
      continue
    }
    if (arg === "--skip-patrimonio") {
      skipPatrimonio = true
      continue
    }
    const slugMatch = /^--financiamento-slugs=(.+)$/.exec(arg)
    if (slugMatch) {
      financiamentoSlugs = slugMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      continue
    }
    const patrimonioSlugMatch = /^--patrimonio-slugs=(.+)$/.exec(arg)
    if (patrimonioSlugMatch) {
      patrimonioSlugs = patrimonioSlugMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      continue
    }
    const n = Number(arg)
    if (Number.isInteger(n) && n > 1900 && n < 2100) anos.push(n)
  }
  if (process.env.PF_TSE_INGEST_SKIP_PATRIMONIO === "1") skipPatrimonio = true
  if (process.env.PF_TSE_INGEST_DRY_RUN === "1") dryRun = true
  const envSlugs = process.env.PF_TSE_FINANCIAMENTO_SLUGS?.trim()
  const financiamentoAllow =
    financiamentoSlugs != null && financiamentoSlugs.length > 0
      ? new Set(financiamentoSlugs)
      : envSlugs
        ? new Set(
            envSlugs
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
        )
        : null
  const envPatrimonioSlugs = process.env.PF_TSE_PATRIMONIO_SLUGS?.trim()
  const patrimonioAllow =
    patrimonioSlugs != null && patrimonioSlugs.length > 0
      ? new Set(patrimonioSlugs)
      : envPatrimonioSlugs
        ? new Set(
            envPatrimonioSlugs
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        : null
  return {
    anos: anos.length > 0 ? anos : DEFAULT_ANOS,
    options: {
      skipPatrimonio,
      patrimonioSlugAllowlist: patrimonioAllow,
      financiamentoSlugAllowlist: financiamentoAllow,
      dryRun,
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { anos, options } = parseIngestTseCli()
  const plannedRows: PlannedTseRow[] = []
  if (options.dryRun) options.onPlannedRow = (entry) => plannedRows.push(entry)
  ingestTSE(anos, options).then((results) => {
    console.log(JSON.stringify(options.dryRun ? { dryRun: true, results, plannedRows } : results, null, 2))
  })
}
