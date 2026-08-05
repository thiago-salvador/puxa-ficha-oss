/**
 * Backfill de CPF a partir do consulta_cand do TSE (2026-08-05).
 *
 * POR QUE EXISTE: a varredura de sanções do Portal da Transparência só consulta
 * candidato com CPF válido (guard de `ingest-transparencia-sanctions`). Na
 * rodada de 05/08, 96 dos 194 publicáveis ficaram de fora por CPF ausente, e o
 * relatório de cobertura os marca como "não sabemos" em sanções. O CPF está
 * publicado pelo próprio TSE no `consulta_cand` (coluna `NR_CPF_CANDIDATO`):
 * 2026 para quem já registrou candidatura, 2010-2024 para veteranos.
 *
 * REGRA DE IDENTIDADE (a parte que importa num site de checagem eleitoral):
 * só aceitamos casamento por identidade exata, nunca por nome solto. Duas
 * rotas, nesta ordem:
 *
 * 1. `sq`: o `SQ_CANDIDATO` da linha bate com o `tse_sq_candidato` do seed
 *    para aquele ano. O SQ do seed é curadoria por pleito e, de 2010 em
 *    diante, o SQ é chave global do TSE (por isso a varredura não desce de
 *    2010: até 2008 o SQ é sequencial por UF e colide entre estados).
 * 2. `nome-nascimento`: nome completo normalizado E data de nascimento
 *    idênticos aos do banco. Nome sozinho NUNCA casa (mesma regra do
 *    `tse-resolver`, ver o comentário de `shouldSkipWeakMatch`).
 *
 *    ESTA ROTA NÃO PERSISTE SOZINHA, só marca para revisão humana. O caso que
 *    provou o porquê, na primeira execução (2026-08-05): `jarbas-soares`
 *    casou por nome+nascimento com um vice-prefeito de 2020 em MG chamado
 *    "Jarbas Soares". A ficha é de Jarbas Soares Júnior, ex-procurador-geral
 *    de justiça de MG, que passou 36 anos no MPMG e não podia ter sido
 *    candidato a vereador em 2008 nem a vice-prefeito em 2020; e a
 *    `data_nascimento` do banco tinha proveniência TSE, ou seja,
 *    provavelmente veio do MESMO casamento por nome da era pré-guard que a
 *    rota estaria "confirmando". Validação circular: o dado errado confirma o
 *    dado errado. Sem proveniência independente da data de nascimento, a rota
 *    2 é sugestão, nunca persistência.
 *
 * Qualquer ambiguidade derruba o candidato inteiro para revisão humana:
 * CPFs distintos entre anos na rota `sq`, CPFs distintos na rota
 * `nome-nascimento` (homônimo com mesma data de nascimento), divergência
 * entre as duas rotas, ou dois alvos nossos com a mesma chave nome+nascimento.
 * Campo vazio é recuperável; CPF de outra pessoa vira acusação falsa na
 * varredura de sanções.
 *
 * O QUE PERSISTE: `candidatos.cpf`, fill-only (`WHERE cpf IS NULL`), nunca
 * sobrescreve. Cada alvo ganha rastro em `coleta_log` (fonte `tse-cpf`):
 * `encontrado` com o método e os anos de evidência, `vazio_confirmado` quando
 * todos os pleitos foram varridos sem match exato, `erro` quando algum pleito
 * falhou no download (aí "não achei" não é prova) ou quando houve conflito.
 *
 * USO:
 *   npx tsx scripts/backfill-cpf-tse.ts             # dry-run, só relata
 *   npx tsx scripts/backfill-cpf-tse.ts --apply     # persiste e loga
 *
 * Auditoria completa (com os CPFs e as linhas de evidência) em
 * `data/tse-cpf/backfill-cpf-audit.json`, fora do git.
 */
import { existsSync, mkdirSync, createWriteStream, readdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { execSync } from "node:child_process"
import { supabase } from "./lib/supabase"
import { loadCandidatos, parseCSV, normalizeForMatch } from "./lib/helpers"
import { cpfEhValido, somenteDigitos } from "./lib/ingest-transparencia-sanctions"
import { registrarColetas, type EntradaColeta } from "./lib/coleta-log"
import { log, warn, error } from "./lib/logger"

const DATA_DIR = resolve(process.cwd(), "data/tse-cpf")
const AUDIT_PATH = resolve(DATA_DIR, "backfill-cpf-audit.json")

/** 2026 para quem registrou; 2010-2024 para veteranos. Nada antes de 2010 (SQ por UF). */
export const ANOS_VARRIDOS = [2026, 2024, 2022, 2020, 2018, 2016, 2014, 2012, 2010]

export type MetodoCasamento = "sq" | "nome-nascimento"

export interface HitCpf {
  cpf: string
  metodo: MetodoCasamento
  ano: number
  uf: string
  cargo: string
  sq: string
  nomeCsv: string
}

export interface AlvoBackfill {
  slug: string
  nome_completo: string
  data_nascimento: string | null
  estado: string | null
}

export type DecisaoCpf =
  | { decisao: "persistir"; cpf: string; metodo: MetodoCasamento; evidencias: HitCpf[] }
  | { decisao: "revisao"; motivo: string; evidencias: HitCpf[] }
  | { decisao: "conflito"; motivo: string; evidencias: HitCpf[] }
  | { decisao: "nenhum" }

/** `DD/MM/YYYY` -> `YYYY-MM-DD`; vazio quando o formato não fecha. */
export function converterDataBR(valor: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((valor ?? "").trim())
  if (!m) return ""
  const [, dd, mm, yyyy] = m
  const dia = Number(dd)
  const mes = Number(mm)
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return ""
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`
}

/** Chave da rota 2: nome completo normalizado + data ISO. */
export function chaveNomeNascimento(nome: string, dataIso: string): string {
  const nomeNorm = normalizeForMatch(nome)
  if (!nomeNorm || !dataIso) return ""
  return `${nomeNorm}|${dataIso}`
}

/**
 * Decide o CPF de um candidato a partir dos hits acumulados na varredura.
 *
 * Regras, na ordem:
 * - rota `sq` com CPFs distintos entre anos: conflito (seed com SQ errado em
 *   algum ano, ou TSE inconsistente; revisão humana).
 * - rota `sq` única + rota `nome-nascimento` divergente: conflito (uma das
 *   duas identidades está errada; não escolhemos no escuro).
 * - rota `sq` única (com ou sem nome-nascimento concordando): persistir.
 * - só `nome-nascimento`: revisão humana, NUNCA persiste (ver o caso
 *   jarbas-soares no comentário do módulo: validação circular quando a data
 *   de nascimento do banco veio de casamento por nome).
 * - sem hits: nenhum.
 */
export function decidirCpfDoCandidato(hits: HitCpf[]): DecisaoCpf {
  if (hits.length === 0) return { decisao: "nenhum" }

  const porSq = hits.filter((h) => h.metodo === "sq")
  const porNome = hits.filter((h) => h.metodo === "nome-nascimento")
  const cpfsSq = [...new Set(porSq.map((h) => h.cpf))]
  const cpfsNome = [...new Set(porNome.map((h) => h.cpf))]

  if (cpfsSq.length > 1) {
    return {
      decisao: "conflito",
      motivo: `rota sq devolveu ${cpfsSq.length} CPFs distintos entre anos`,
      evidencias: hits,
    }
  }

  if (cpfsSq.length === 1) {
    const divergente = cpfsNome.some((cpf) => cpf !== cpfsSq[0])
    if (divergente) {
      return {
        decisao: "conflito",
        motivo: "rota sq e rota nome-nascimento discordam de CPF",
        evidencias: hits,
      }
    }
    return { decisao: "persistir", cpf: cpfsSq[0], metodo: "sq", evidencias: porSq }
  }

  if (cpfsNome.length === 1) {
    return {
      decisao: "revisao",
      motivo:
        "so rota nome+nascimento, sem SQ: exige revisao humana (risco de validacao circular quando a data de nascimento do banco veio de casamento por nome)",
      evidencias: porNome,
    }
  }

  return {
    decisao: "conflito",
    motivo: `rota nome-nascimento devolveu ${cpfsNome.length} CPFs distintos (homonimo com mesma data de nascimento)`,
    evidencias: hits,
  }
}

/**
 * Mapa nome+nascimento -> slug, derrubando colisões internas: se dois alvos
 * nossos compartilham a chave, nenhum dos dois pode usar a rota 2.
 */
export function montarMapaNomeNascimento(alvos: AlvoBackfill[]): {
  mapa: Map<string, string>
  colididos: string[]
} {
  const mapa = new Map<string, string>()
  const donos = new Map<string, string[]>()
  for (const alvo of alvos) {
    if (!alvo.data_nascimento) continue
    const chave = chaveNomeNascimento(alvo.nome_completo, alvo.data_nascimento)
    if (!chave) continue
    donos.set(chave, [...(donos.get(chave) ?? []), alvo.slug])
  }
  const colididos: string[] = []
  for (const [chave, slugs] of donos) {
    if (slugs.length === 1) {
      mapa.set(chave, slugs[0])
    } else {
      colididos.push(...slugs)
    }
  }
  return { mapa, colididos: colididos.sort() }
}

async function baixarArquivo(url: string, destino: string): Promise<boolean> {
  if (existsSync(destino)) {
    log("tse-cpf", `  Cache hit: ${destino}`)
    return true
  }
  log("tse-cpf", `  Baixando: ${url}`)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      warn("tse-cpf", `  HTTP ${res.status} para ${url}`)
      return false
    }
    const stream = createWriteStream(destino)
    const reader = res.body?.getReader()
    if (!reader) return false
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      stream.write(value)
    }
    stream.end()
    await new Promise<void>((res2, rej) => {
      stream.on("finish", res2)
      stream.on("error", rej)
    })
    return true
  } catch (err) {
    warn("tse-cpf", `  Falha no download: ${err}`)
    try {
      rmSync(destino, { force: true })
    } catch {
      /* melhor deixar o arquivo parcial do que falhar duas vezes */
    }
    return false
  }
}

function extrairZip(zipPath: string, dir: string) {
  mkdirSync(dir, { recursive: true })
  execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: "pipe" })
}

function listarCSVs(dir: string): string[] {
  try {
    return (readdirSync(dir) as string[])
      .filter((f) => f.endsWith(".csv") && f.startsWith("consulta_cand_"))
      .map((f) => resolve(dir, f))
  } catch {
    return []
  }
}

interface ResultadoAno {
  ano: number
  ok: boolean
  linhas: number
}

async function varrerAno(
  ano: number,
  sqParaSlug: Map<string, string>,
  nomeNascParaSlug: Map<string, string>,
  hitsPorSlug: Map<string, HitCpf[]>,
): Promise<ResultadoAno> {
  const zipUrl = `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ano}.zip`
  const zipPath = resolve(DATA_DIR, `consulta_cand_${ano}.zip`)
  const extractDir = resolve(DATA_DIR, `consulta_cand_${ano}`)

  log("tse-cpf", `=== Varrendo ${ano} ===`)
  const ok = await baixarArquivo(zipUrl, zipPath)
  if (!ok) return { ano, ok: false, linhas: 0 }

  try {
    extrairZip(zipPath, extractDir)
  } catch (err) {
    error("tse-cpf", `Falha ao extrair ${ano}: ${err}`)
    // Zip corrompido não serve de cache: sem apagar, toda re-execução repete a falha.
    rmSync(zipPath, { force: true })
    return { ano, ok: false, linhas: 0 }
  }

  const csvs = listarCSVs(extractDir)
  if (csvs.length === 0) {
    warn("tse-cpf", `Nenhum CSV em ${ano}`)
    rmSync(extractDir, { recursive: true, force: true })
    return { ano, ok: false, linhas: 0 }
  }

  let linhas = 0
  const registrar = (slug: string, hit: HitCpf) => {
    hitsPorSlug.set(slug, [...(hitsPorSlug.get(slug) ?? []), hit])
  }

  for (const csv of csvs) {
    linhas += await parseCSV(csv, (row) => {
      const cpf = somenteDigitos(row.NR_CPF_CANDIDATO || "")
      if (!cpfEhValido(cpf)) return

      const base = {
        cpf,
        ano,
        uf: (row.SG_UF || "").trim().toUpperCase(),
        cargo: (row.DS_CARGO || "").trim(),
        sq: (row.SQ_CANDIDATO || "").trim(),
        nomeCsv: (row.NM_CANDIDATO || "").trim(),
      }

      const slugPorSq = base.sq ? sqParaSlug.get(`${ano}|${base.sq}`) : undefined
      if (slugPorSq) {
        registrar(slugPorSq, { ...base, metodo: "sq" })
        return
      }

      const chave = chaveNomeNascimento(row.NM_CANDIDATO || "", converterDataBR(row.DT_NASCIMENTO || ""))
      if (!chave) return
      const slugPorNome = nomeNascParaSlug.get(chave)
      if (slugPorNome) {
        registrar(slugPorNome, { ...base, metodo: "nome-nascimento" })
      }
    })
  }

  // O zip fica de cache para re-execução; os CSVs extraídos (10x maiores) saem.
  rmSync(extractDir, { recursive: true, force: true })
  log("tse-cpf", `  ${ano}: ${linhas} linhas varridas`)
  return { ano, ok: true, linhas }
}

async function carregarAlvos(): Promise<AlvoBackfill[]> {
  const { data: publicos, error: errPub } = await supabase.from("candidatos_publico").select("slug")
  if (errPub) throw new Error(`candidatos_publico: ${errPub.message}`)
  const slugsPublicos = new Set((publicos ?? []).map((r) => r.slug as string))

  const { data, error: errCand } = await supabase
    .from("candidatos")
    .select("slug, nome_completo, data_nascimento, estado, cpf")
  if (errCand) throw new Error(`candidatos: ${errCand.message}`)

  return (data ?? [])
    .filter((r) => slugsPublicos.has(r.slug as string) && !r.cpf)
    .map((r) => ({
      slug: r.slug as string,
      nome_completo: (r.nome_completo as string) ?? "",
      data_nascimento: (r.data_nascimento as string | null) ?? null,
      estado: (r.estado as string | null) ?? null,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

async function main() {
  const apply = process.argv.includes("--apply")
  mkdirSync(DATA_DIR, { recursive: true })

  const alvos = await carregarAlvos()
  log("tse-cpf", `${alvos.length} publicáveis sem CPF no banco`)
  if (alvos.length === 0) return

  const alvosSet = new Set(alvos.map((a) => a.slug))
  const seed = loadCandidatos().filter((c) => alvosSet.has(c.slug))

  // Rota 1: SQ por ano, só dos alvos e só de 2010 em diante.
  const sqParaSlug = new Map<string, string>()
  for (const cand of seed) {
    const porAno = cand.ids.tse_sq_candidato ?? {}
    for (const [anoStr, sq] of Object.entries(porAno)) {
      const ano = Number(anoStr)
      if (!sq || !ANOS_VARRIDOS.includes(ano)) continue
      sqParaSlug.set(`${ano}|${String(sq).trim()}`, cand.slug)
    }
  }

  // Rota 2: nome+nascimento, com colisão interna derrubada.
  const { mapa: nomeNascParaSlug, colididos } = montarMapaNomeNascimento(alvos)
  if (colididos.length > 0) {
    warn("tse-cpf", `Chave nome+nascimento colide entre alvos, rota 2 desativada para: ${colididos.join(", ")}`)
  }

  const comRota1 = new Set([...sqParaSlug.values()])
  const comRota2 = new Set([...nomeNascParaSlug.values()])
  const semRota = alvos.filter((a) => !comRota1.has(a.slug) && !comRota2.has(a.slug))
  log(
    "tse-cpf",
    `Rotas: ${comRota1.size} com SQ no seed, ${comRota2.size} com nome+nascimento, ${semRota.length} sem rota exata (ficam como lacuna)`,
  )

  const hitsPorSlug = new Map<string, HitCpf[]>()
  const resultadosAno: ResultadoAno[] = []
  for (const ano of ANOS_VARRIDOS) {
    resultadosAno.push(await varrerAno(ano, sqParaSlug, nomeNascParaSlug, hitsPorSlug))
  }
  const anosFalhados = resultadosAno.filter((r) => !r.ok).map((r) => r.ano)

  // Decisão por alvo
  const decisoes = alvos.map((alvo) => ({
    alvo,
    decisao: decidirCpfDoCandidato(hitsPorSlug.get(alvo.slug) ?? []),
  }))

  const persistiveis = decisoes.filter((d) => d.decisao.decisao === "persistir")
  const revisoes = decisoes.filter((d) => d.decisao.decisao === "revisao")
  const conflitos = decisoes.filter((d) => d.decisao.decisao === "conflito")
  const semMatch = decisoes.filter((d) => d.decisao.decisao === "nenhum")

  log(
    "tse-cpf",
    `Decisões: ${persistiveis.length} persistíveis, ${revisoes.length} para revisão humana, ${conflitos.length} conflitos, ${semMatch.length} sem match`,
  )
  for (const { alvo, decisao } of [...revisoes, ...conflitos]) {
    if (decisao.decisao === "revisao" || decisao.decisao === "conflito") {
      warn("tse-cpf", `  ${decisao.decisao.toUpperCase()} ${alvo.slug}: ${decisao.motivo}`)
    }
  }

  let persistidos = 0
  const entradasLog: EntradaColeta[] = []

  for (const { alvo, decisao } of decisoes) {
    if (decisao.decisao === "persistir") {
      const anos = [...new Set(decisao.evidencias.map((e) => e.ano))].sort((a, b) => b - a)
      const detalhe = `backfill-cpf: consulta_cand via ${decisao.metodo} (${anos.join(", ")})`
      if (apply) {
        const { error: errUp, count } = await supabase
          .from("candidatos")
          .update({ cpf: decisao.cpf }, { count: "exact" })
          .eq("slug", alvo.slug)
          .is("cpf", null)
        if (errUp) {
          error("tse-cpf", `  ${alvo.slug}: falha ao persistir: ${errUp.message}`)
          entradasLog.push({ fonte: "tse-cpf", alvo: alvo.slug, resultado: "erro", detalhe: `backfill-cpf: update falhou: ${errUp.message}` })
          continue
        }
        if ((count ?? 0) === 0) {
          warn("tse-cpf", `  ${alvo.slug}: cpf já preenchido por outra sessão, não sobrescrito`)
          continue
        }
        persistidos++
        log("tse-cpf", `  ${alvo.slug}: CPF persistido via ${decisao.metodo} (anos ${anos.join(", ")})`)
      } else {
        log("tse-cpf", `  [dry-run] ${alvo.slug}: persistiria via ${decisao.metodo} (anos ${anos.join(", ")})`)
      }
      entradasLog.push({ fonte: "tse-cpf", alvo: alvo.slug, resultado: "encontrado", volume: 1, detalhe })
    } else if (decisao.decisao === "revisao") {
      entradasLog.push({
        fonte: "tse-cpf",
        alvo: alvo.slug,
        resultado: "erro",
        detalhe: `backfill-cpf: candidato a CPF encontrado, aguarda revisão humana (${decisao.motivo})`,
      })
    } else if (decisao.decisao === "conflito") {
      entradasLog.push({
        fonte: "tse-cpf",
        alvo: alvo.slug,
        resultado: "erro",
        detalhe: `backfill-cpf: conflito de identidade, revisão humana (${decisao.motivo})`,
      })
    } else {
      // Sem match: só é vazio provado se todos os pleitos foram varridos.
      if (anosFalhados.length > 0) {
        entradasLog.push({
          fonte: "tse-cpf",
          alvo: alvo.slug,
          resultado: "erro",
          detalhe: `backfill-cpf: sem match, mas pleitos ${anosFalhados.join(", ")} falharam no download`,
        })
      } else {
        entradasLog.push({
          fonte: "tse-cpf",
          alvo: alvo.slug,
          resultado: "vazio_confirmado",
          detalhe: "backfill-cpf: sem match exato (sq/nome+nascimento) em consulta_cand 2010-2026",
        })
      }
    }
  }

  if (apply) {
    await registrarColetas(entradasLog)
    log("tse-cpf", `coleta_log: ${entradasLog.length} linhas registradas (fonte tse-cpf)`)
  }

  const auditoria = {
    gerado_em: new Date().toISOString(),
    apply,
    anos_varridos: ANOS_VARRIDOS,
    anos_falhados: anosFalhados,
    alvos: alvos.length,
    persistiveis: persistiveis.length,
    persistidos,
    revisoes: revisoes.length,
    conflitos: conflitos.length,
    sem_match: semMatch.length,
    rota2_colisoes_internas: colididos,
    decisoes: decisoes.map(({ alvo, decisao }) => ({ slug: alvo.slug, ...decisao })),
  }
  writeFileSync(AUDIT_PATH, `${JSON.stringify(auditoria, null, 2)}\n`)
  log("tse-cpf", `Auditoria em ${AUDIT_PATH}`)
  log(
    "tse-cpf",
    `Resumo: ${alvos.length} alvos | ${persistiveis.length} persistíveis (${apply ? `${persistidos} persistidos` : "dry-run"}) | ${revisoes.length} revisão humana | ${conflitos.length} conflitos | ${semMatch.length} sem match | anos falhados: ${anosFalhados.length === 0 ? "nenhum" : anosFalhados.join(", ")}`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error("tse-cpf", err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
