import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
  FONTES_POR_CANDIDATO,
  FONTES_POR_COLUNA
} from "./lib/coleta-proveniencia"

const CANDIDATOS_ESPERADOS = 194
const CELULAS_ESPERADAS = 4462

export type EstadoCelula = "ok" | "partial" | "missing" | "zero" | "na"
export type ProvenienciaCelula = string | null
export type ClassificacaoResiduo =
  | "N/A"
  | "fonte indisponível"
  | "identidade sem prova"
  | "curadoria em andamento"
  | "aguardando aprovação"
  | "busca esgotada no escopo"
  | "erro de código ainda aberto"

export interface CelulaHtml {
  slug: string
  coluna: string
  estado: EstadoCelula
  proveniencia: ProvenienciaCelula
  texto: string
  detalhe: string | null
}

export interface UltimaColetaSnapshot {
  resultado: string
  volume?: number
  executado_em?: string
  detalhe?: string | null
}

export interface CandidatoSnapshot {
  slug: string
  nome_urna?: string
  estado?: string | null
  coleta?: Record<string, UltimaColetaSnapshot>
  coletas?: Record<string, UltimaColetaSnapshot>
  itensRevisar?: Array<{
    id?: string
    classe?: string
    titulo?: string
    detalhe?: string | null
    fonte?: string | null
    url?: string | null
  }>
  [chave: string]: unknown
}

interface Classificacao {
  classificacao: ClassificacaoResiduo | null
  motivo: string
}

export interface OpcoesReconciliacao {
  beforeHtml: string
  beforeSnapshot: string
  afterHtml: string
  afterSnapshot: string
  out: string
}

interface ConsultaFonteCandidato {
  slug: string
  fonte: string
  before: UltimaColetaSnapshot
  after: UltimaColetaSnapshot
  transicao: string
  eraResiduo: boolean
  continuaResiduo: boolean
  reducaoLegitima: boolean
  mudouApenasCategoria: boolean
  classificacao: ClassificacaoResiduo | null
  motivo: string
}

interface ComparacaoCelula {
  slug: string
  coluna: string
  before: Pick<CelulaHtml, "estado" | "proveniencia" | "texto" | "detalhe">
  after: Pick<CelulaHtml, "estado" | "proveniencia" | "texto" | "detalhe">
  transicaoEstado: string
  transicaoProveniencia: string
  eraResiduo: boolean
  continuaResiduo: boolean
  reducaoLegitima: boolean
  mudouApenasCategoria: boolean
  classificacao: ClassificacaoResiduo | null
  motivo: string
}

export interface EvidenciaReconciliacao {
  schema_version: 1
  metadata: {
    gerado_em: string
    inputs: OpcoesReconciliacao
    esperado: { candidatos: number; celulas: number }
    observado: {
      before: { candidatos: number; celulas: number }
      after: { candidatos: number; celulas: number }
    }
    validacoes: {
      candidatos_before: boolean
      candidatos_after: boolean
      celulas_before: boolean
      celulas_after: boolean
      mesmos_candidatos: boolean
      mesmas_celulas: boolean
    }
  }
  totais: {
    before: {
      estado: Record<string, number>
      proveniencia: Record<string, number>
      resultado_fonte: Record<string, number>
    }
    after: {
      estado: Record<string, number>
      proveniencia: Record<string, number>
      resultado_fonte: Record<string, number>
    }
    delta: {
      estado: Record<string, number>
      proveniencia: Record<string, number>
      resultado_fonte: Record<string, number>
    }
    reducoes_legitimas: { celulas: number; consultas_fonte_candidato: number }
    mudancas_apenas_de_categoria: { celulas: number; consultas_fonte_candidato: number }
    residuos_after: number
  }
  breakdown: {
    por_coluna: Record<string, unknown>
    por_fonte: Record<string, unknown>
    por_candidato: Record<string, unknown>
    por_celula: ComparacaoCelula[]
    por_consulta_fonte_candidato: ConsultaFonteCandidato[]
  }
  transicoes: {
    estado: Record<string, number>
    proveniencia: Record<string, number>
    resultado_fonte: Record<string, number>
  }
  residuos: Array<Record<string, unknown> & Classificacao>
}

function decodificarHtml(valor: string): string {
  return valor
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, numero: string) => String.fromCodePoint(Number(numero)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, numero: string) =>
      String.fromCodePoint(Number.parseInt(numero, 16))
    )
}

function atributosHtml(texto: string): Record<string, string> {
  const atributos: Record<string, string> = {}
  for (const match of texto.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    atributos[match[1].toLowerCase()] = decodificarHtml(match[2] ?? match[3] ?? "")
  }
  return atributos
}

function textoHtml(texto: string): string {
  return decodificarHtml(texto.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

export function parsearCelulasHtml(html: string): CelulaHtml[] {
  const celulas: CelulaHtml[] = []
  const chaves = new Set<string>()

  for (const match of html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
    const atributos = atributosHtml(match[1])
    if (!atributos["data-slug"] || !atributos["data-col"]) continue
    const estado = atributos.class?.match(/(?:^|\s)c-(ok|partial|missing|zero|na)(?:\s|$)/)?.[1]
    if (!estado) continue

    const chave = `${atributos["data-slug"]}\u0000${atributos["data-col"]}`
    if (chaves.has(chave)) throw new Error(`célula duplicada no HTML: ${chave.replace("\u0000", "/")}`)
    chaves.add(chave)
    celulas.push({
      slug: atributos["data-slug"],
      coluna: atributos["data-col"],
      estado: estado as EstadoCelula,
      proveniencia: atributos["data-prov"] ?? null,
      texto: textoHtml(match[2]),
      detalhe: atributos.title ?? null
    })
  }

  return celulas.sort((a, b) =>
    a.slug.localeCompare(b.slug, "pt-BR") || a.coluna.localeCompare(b.coluna, "pt-BR")
  )
}

export function normalizarSnapshot(valor: unknown): CandidatoSnapshot[] {
  let candidatos: unknown = valor
  if (!Array.isArray(candidatos) && candidatos && typeof candidatos === "object") {
    candidatos = (candidatos as { snapshot?: unknown }).snapshot
  }
  if (
    Array.isArray(candidatos) &&
    candidatos.length === 1 &&
    candidatos[0] &&
    typeof candidatos[0] === "object" &&
    Array.isArray((candidatos[0] as { snapshot?: unknown }).snapshot)
  ) {
    candidatos = (candidatos[0] as { snapshot: unknown[] }).snapshot
  }
  if (!Array.isArray(candidatos)) throw new Error("snapshot não contém um array de candidatos")

  const slugs = new Set<string>()
  return candidatos.map((item, indice) => {
    if (!item || typeof item !== "object" || typeof (item as { slug?: unknown }).slug !== "string") {
      throw new Error(`snapshot: candidato inválido no índice ${indice}`)
    }
    const candidato = item as CandidatoSnapshot
    if (slugs.has(candidato.slug)) throw new Error(`snapshot: slug duplicado ${candidato.slug}`)
    slugs.add(candidato.slug)
    return candidato
  })
}

function coletaDo(candidato: CandidatoSnapshot): Record<string, UltimaColetaSnapshot> {
  return candidato.coleta ?? candidato.coletas ?? {}
}

const PADRAO_INDISPONIVEL =
  /\b(indispon[ií]vel|fora do ar|timeout|timed out|credencial|api[_ ]?key|token ausente|http\s*[45]\d\d|dns|econn|connection refused|service unavailable)\b/i
const PADRAO_IDENTIDADE =
  /\b(identidade|hom[oô]nimo|homon[ií]mia|sq(?:_candidato)?|nome civil|segundo identificador|cpf divergente|pessoa errada)\b/i
const PADRAO_CURADORIA =
  /\b(curadoria|revis[aã]o|pesquisa|busca)\b.{0,45}\b(em andamento|pendente|incompleta|n[aã]o conclu[ií]da|restante)\b/i
const PADRAO_APROVACAO = /\b(aguardando|pendente de|depende de)\b.{0,35}\b(aprova[cç][aã]o|decis[aã]o|revis[aã]o humana)\b/i
const PADRAO_ERRO_CODIGO =
  /\b(erro de c[oó]digo|bug|typeerror|referenceerror|syntaxerror|stack trace|falha no script|exce[cç][aã]o n[aã]o tratada)\b/i

export function classificarConsulta(
  resultado: string,
  detalhe: string | null | undefined
): Classificacao {
  const texto = detalhe?.trim() ?? ""
  if (resultado === "nao_aplicavel") {
    return { classificacao: "N/A", motivo: "resultado nao_aplicavel registrado na fonte" }
  }
  if (resultado === "sem_achado_no_escopo") {
    return {
      classificacao: "busca esgotada no escopo",
      motivo: "resultado sem_achado_no_escopo; não prova ausência absoluta"
    }
  }
  if (PADRAO_IDENTIDADE.test(texto)) {
    return { classificacao: "identidade sem prova", motivo: "detalhe explicita bloqueio de identidade" }
  }
  if (PADRAO_APROVACAO.test(texto)) {
    return { classificacao: "aguardando aprovação", motivo: "detalhe explicita decisão pendente" }
  }
  if (PADRAO_CURADORIA.test(texto)) {
    return { classificacao: "curadoria em andamento", motivo: "detalhe explicita trabalho em andamento" }
  }
  if (PADRAO_ERRO_CODIGO.test(texto)) {
    return { classificacao: "erro de código ainda aberto", motivo: "detalhe explicita falha de código" }
  }
  if (resultado === "erro" && PADRAO_INDISPONIVEL.test(texto)) {
    return { classificacao: "fonte indisponível", motivo: "erro com indisponibilidade explícita no detalhe" }
  }
  return {
    classificacao: "curadoria em andamento",
    motivo:
      resultado === "nunca_verificado"
        ? "não há tentativa registrada; a consulta continua pendente e isso não prova ausência"
        : "o resultado e o detalhe não encerram a consulta; a curadoria continua pendente"
  }
}

function chaveCelula(celula: Pick<CelulaHtml, "slug" | "coluna">): string {
  return `${celula.slug}\u0000${celula.coluna}`
}

function chaveConsulta(slug: string, fonte: string): string {
  return `${slug}\u0000${fonte}`
}

function provChave(proveniencia: ProvenienciaCelula): string {
  return proveniencia ?? "sem_proveniencia"
}

function incrementar(contagem: Record<string, number>, chave: string, valor = 1): void {
  contagem[chave] = (contagem[chave] ?? 0) + valor
}

function contar<T>(itens: T[], chave: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of itens) incrementar(out, chave(item))
  return out
}

function delta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const chave of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    out[chave] = (after[chave] ?? 0) - (before[chave] ?? 0)
  }
  return out
}

function numeroDoTexto(texto: string): number {
  const numero = Number.parseInt(texto.replace(/\D/g, ""), 10)
  return Number.isFinite(numero) ? numero : 0
}

function celulaEhResiduo(celula: CelulaHtml): boolean {
  if (celula.estado === "na") return true
  if (celula.coluna === "revisar" && numeroDoTexto(celula.texto) > 0) return true
  if (celula.estado === "missing") return true
  if (celula.estado !== "zero") return false
  return !["zero_provado", "coletado"].includes(celula.proveniencia ?? "")
}

function consultaEhResiduo(consulta: UltimaColetaSnapshot): boolean {
  return !["encontrado", "vazio_confirmado"].includes(consulta.resultado)
}

function classificacaoDaCelula(
  celula: CelulaHtml,
  consultas: Map<string, ConsultaFonteCandidato>
): Classificacao {
  if (celula.estado === "na") return { classificacao: "N/A", motivo: "estado da célula é na" }
  if (celula.coluna === "revisar" && numeroDoTexto(celula.texto) > 0) {
    return { classificacao: "aguardando aprovação", motivo: "célula agrega itens de revisão pendentes" }
  }
  if (celula.proveniencia === "curadoria_concluida_sem_achado") {
    return {
      classificacao: "busca esgotada no escopo",
      motivo: "proveniência da célula registra curadoria concluída no escopo"
    }
  }

  const fontes = FONTES_POR_COLUNA[celula.coluna] ?? []
  const classificacoes = fontes
    .map((fonte) => consultas.get(chaveConsulta(celula.slug, fonte))?.classificacao ?? null)
    .filter((item): item is ClassificacaoResiduo => item !== null)
  const unicas = [...new Set(classificacoes)]
  if (unicas.length === 1) {
    return { classificacao: unicas[0], motivo: "classificação unívoca das fontes da coluna" }
  }
  return {
    classificacao: "curadoria em andamento",
    motivo:
      unicas.length > 1
        ? `fontes da coluna apontam causas diferentes (${unicas.join(", ")}); a célula continua em curadoria`
        : "estado/proveniência da célula não encerram o resíduo; a curadoria continua pendente"
  }
}

function validarConjunto(nome: string, before: Set<string>, after: Set<string>): void {
  const faltam = [...before].filter((item) => !after.has(item))
  const sobram = [...after].filter((item) => !before.has(item))
  if (faltam.length || sobram.length) {
    throw new Error(`${nome} divergem: faltam=${faltam.slice(0, 5)} sobram=${sobram.slice(0, 5)}`)
  }
}

function agregarComparacoes<T extends { slug: string }>(
  itens: T[],
  campos: (item: T) => { reducaoLegitima: boolean; mudouApenasCategoria: boolean }
): Record<string, { total: number; reducoes_legitimas: number; mudancas_apenas_categoria: number }> {
  const out: Record<string, { total: number; reducoes_legitimas: number; mudancas_apenas_categoria: number }> = {}
  for (const item of itens) {
    const linha = (out[item.slug] ??= { total: 0, reducoes_legitimas: 0, mudancas_apenas_categoria: 0 })
    linha.total++
    const f = campos(item)
    if (f.reducaoLegitima) linha.reducoes_legitimas++
    if (f.mudouApenasCategoria) linha.mudancas_apenas_categoria++
  }
  return out
}

export function reconciliarCobertura(
  beforeHtml: string,
  beforeSnapshotValor: unknown,
  afterHtml: string,
  afterSnapshotValor: unknown,
  inputs: OpcoesReconciliacao,
  geradoEm = new Date().toISOString()
): EvidenciaReconciliacao {
  const celulasBefore = parsearCelulasHtml(beforeHtml)
  const celulasAfter = parsearCelulasHtml(afterHtml)
  const candidatosBefore = normalizarSnapshot(beforeSnapshotValor)
  const candidatosAfter = normalizarSnapshot(afterSnapshotValor)

  if (candidatosBefore.length !== CANDIDATOS_ESPERADOS) {
    throw new Error(`snapshot before: esperado 194 candidatos, recebido ${candidatosBefore.length}`)
  }
  if (candidatosAfter.length !== CANDIDATOS_ESPERADOS) {
    throw new Error(`snapshot after: esperado 194 candidatos, recebido ${candidatosAfter.length}`)
  }
  if (celulasBefore.length !== CELULAS_ESPERADAS) {
    throw new Error(`HTML before: esperado 4462 células, recebido ${celulasBefore.length}`)
  }
  if (celulasAfter.length !== CELULAS_ESPERADAS) {
    throw new Error(`HTML after: esperado 4462 células, recebido ${celulasAfter.length}`)
  }

  const slugsBefore = new Set(candidatosBefore.map((c) => c.slug))
  const slugsAfter = new Set(candidatosAfter.map((c) => c.slug))
  validarConjunto("candidatos before/after", slugsBefore, slugsAfter)
  validarConjunto(
    "células before/after",
    new Set(celulasBefore.map(chaveCelula)),
    new Set(celulasAfter.map(chaveCelula))
  )
  validarConjunto("candidatos snapshot/HTML before", slugsBefore, new Set(celulasBefore.map((c) => c.slug)))
  validarConjunto("candidatos snapshot/HTML after", slugsAfter, new Set(celulasAfter.map((c) => c.slug)))

  const beforePorSlug = new Map(candidatosBefore.map((c) => [c.slug, c]))
  const afterPorSlug = new Map(candidatosAfter.map((c) => [c.slug, c]))
  const fontes = new Set(FONTES_POR_CANDIDATO)
  for (const candidato of [...candidatosBefore, ...candidatosAfter]) {
    for (const fonte of Object.keys(coletaDo(candidato))) fontes.add(fonte)
  }

  const consultas: ConsultaFonteCandidato[] = []
  const consultaAfterPorChave = new Map<string, ConsultaFonteCandidato>()
  const resultadoAusente: UltimaColetaSnapshot = { resultado: "nunca_verificado" }
  for (const slug of [...slugsAfter].sort()) {
    const before = coletaDo(beforePorSlug.get(slug)!)
    const after = coletaDo(afterPorSlug.get(slug)!)
    for (const fonte of [...fontes].sort()) {
      const b = before[fonte] ?? resultadoAusente
      const a = after[fonte] ?? resultadoAusente
      const eraResiduo = consultaEhResiduo(b)
      const continuaResiduo = consultaEhResiduo(a)
      const mudou = b.resultado !== a.resultado
      const classe = classificarConsulta(a.resultado, a.detalhe)
      const item: ConsultaFonteCandidato = {
        slug,
        fonte,
        before: b,
        after: a,
        transicao: `${b.resultado} -> ${a.resultado}`,
        eraResiduo,
        continuaResiduo,
        reducaoLegitima: eraResiduo && !continuaResiduo,
        mudouApenasCategoria: eraResiduo && continuaResiduo && mudou,
        ...classe
      }
      consultas.push(item)
      consultaAfterPorChave.set(chaveConsulta(slug, fonte), item)
    }
  }

  const beforeCelulas = new Map(celulasBefore.map((c) => [chaveCelula(c), c]))
  const comparacoesCelulas: ComparacaoCelula[] = celulasAfter.map((after) => {
    const before = beforeCelulas.get(chaveCelula(after))!
    const eraResiduo = celulaEhResiduo(before)
    const continuaResiduo = celulaEhResiduo(after)
    const mudouCategoria =
      before.estado !== after.estado || before.proveniencia !== after.proveniencia
    return {
      slug: after.slug,
      coluna: after.coluna,
      before: {
        estado: before.estado,
        proveniencia: before.proveniencia,
        texto: before.texto,
        detalhe: before.detalhe
      },
      after: {
        estado: after.estado,
        proveniencia: after.proveniencia,
        texto: after.texto,
        detalhe: after.detalhe
      },
      transicaoEstado: `${before.estado} -> ${after.estado}`,
      transicaoProveniencia: `${provChave(before.proveniencia)} -> ${provChave(after.proveniencia)}`,
      eraResiduo,
      continuaResiduo,
      reducaoLegitima: eraResiduo && !continuaResiduo,
      mudouApenasCategoria: eraResiduo && continuaResiduo && mudouCategoria,
      ...classificacaoDaCelula(after, consultaAfterPorChave)
    }
  })

  const transicoesEstado = contar(comparacoesCelulas, (c) => c.transicaoEstado)
  const transicoesProveniencia = contar(comparacoesCelulas, (c) => c.transicaoProveniencia)
  const transicoesFonte = contar(consultas, (c) => c.transicao)

  const estadoBefore = contar(celulasBefore, (c) => c.estado)
  const estadoAfter = contar(celulasAfter, (c) => c.estado)
  const provBefore = contar(celulasBefore, (c) => provChave(c.proveniencia))
  const provAfter = contar(celulasAfter, (c) => provChave(c.proveniencia))
  const fonteBefore = contar(consultas, (c) => c.before.resultado)
  const fonteAfter = contar(consultas, (c) => c.after.resultado)

  const porColuna: Record<string, unknown> = {}
  for (const coluna of [...new Set(comparacoesCelulas.map((c) => c.coluna))].sort()) {
    const itens = comparacoesCelulas.filter((c) => c.coluna === coluna)
    porColuna[coluna] = {
      before: {
        estado: contar(itens, (c) => c.before.estado),
        proveniencia: contar(itens, (c) => provChave(c.before.proveniencia))
      },
      after: {
        estado: contar(itens, (c) => c.after.estado),
        proveniencia: contar(itens, (c) => provChave(c.after.proveniencia))
      },
      transicoes_estado: contar(itens, (c) => c.transicaoEstado),
      reducoes_legitimas: itens.filter((c) => c.reducaoLegitima).length,
      mudancas_apenas_categoria: itens.filter((c) => c.mudouApenasCategoria).length
    }
  }

  const porFonte: Record<string, unknown> = {}
  for (const fonte of [...fontes].sort()) {
    const itens = consultas.filter((c) => c.fonte === fonte)
    porFonte[fonte] = {
      before: contar(itens, (c) => c.before.resultado),
      after: contar(itens, (c) => c.after.resultado),
      transicoes: contar(itens, (c) => c.transicao),
      reducoes_legitimas: itens.filter((c) => c.reducaoLegitima).length,
      mudancas_apenas_categoria: itens.filter((c) => c.mudouApenasCategoria).length
    }
  }

  const porCandidato = agregarComparacoes(comparacoesCelulas, (item) => item)
  for (const consulta of consultas) {
    const linha = (porCandidato[consulta.slug] ??= {
      total: 0,
      reducoes_legitimas: 0,
      mudancas_apenas_categoria: 0
    })
    const estendida = linha as typeof linha & {
      consultas_fonte_candidato?: number
      reducoes_legitimas_fontes?: number
      mudancas_apenas_categoria_fontes?: number
    }
    estendida.consultas_fonte_candidato = (estendida.consultas_fonte_candidato ?? 0) + 1
    if (consulta.reducaoLegitima) {
      estendida.reducoes_legitimas_fontes = (estendida.reducoes_legitimas_fontes ?? 0) + 1
    }
    if (consulta.mudouApenasCategoria) {
      estendida.mudancas_apenas_categoria_fontes =
        (estendida.mudancas_apenas_categoria_fontes ?? 0) + 1
    }
  }

  const residuos: EvidenciaReconciliacao["residuos"] = []
  for (const celula of comparacoesCelulas.filter((c) => c.continuaResiduo)) {
    residuos.push({ tipo: "celula", slug: celula.slug, coluna: celula.coluna, ...celula.after,
      classificacao: celula.classificacao, motivo: celula.motivo })
  }
  for (const consulta of consultas.filter((c) => c.continuaResiduo)) {
    residuos.push({
      tipo: "consulta_fonte_candidato",
      slug: consulta.slug,
      fonte: consulta.fonte,
      ...consulta.after,
      classificacao: consulta.classificacao,
      motivo: consulta.motivo
    })
  }
  for (const candidato of candidatosAfter) {
    for (const [indice, item] of (candidato.itensRevisar ?? []).entries()) {
      residuos.push({
        tipo: "item_aprovacao",
        slug: candidato.slug,
        id: item.id ?? `${candidato.slug}:${indice}`,
        classe: item.classe ?? null,
        titulo: item.titulo ?? null,
        detalhe: item.detalhe ?? null,
        fonte: item.fonte ?? null,
        url: item.url ?? null,
        classificacao: "aguardando aprovação",
        motivo: "item explícito na fila itensRevisar do snapshot"
      })
    }
  }

  return {
    schema_version: 1,
    metadata: {
      gerado_em: geradoEm,
      inputs,
      esperado: { candidatos: CANDIDATOS_ESPERADOS, celulas: CELULAS_ESPERADAS },
      observado: {
        before: { candidatos: candidatosBefore.length, celulas: celulasBefore.length },
        after: { candidatos: candidatosAfter.length, celulas: celulasAfter.length }
      },
      validacoes: {
        candidatos_before: true,
        candidatos_after: true,
        celulas_before: true,
        celulas_after: true,
        mesmos_candidatos: true,
        mesmas_celulas: true
      }
    },
    totais: {
      before: { estado: estadoBefore, proveniencia: provBefore, resultado_fonte: fonteBefore },
      after: { estado: estadoAfter, proveniencia: provAfter, resultado_fonte: fonteAfter },
      delta: {
        estado: delta(estadoBefore, estadoAfter),
        proveniencia: delta(provBefore, provAfter),
        resultado_fonte: delta(fonteBefore, fonteAfter)
      },
      reducoes_legitimas: {
        celulas: comparacoesCelulas.filter((c) => c.reducaoLegitima).length,
        consultas_fonte_candidato: consultas.filter((c) => c.reducaoLegitima).length
      },
      mudancas_apenas_de_categoria: {
        celulas: comparacoesCelulas.filter((c) => c.mudouApenasCategoria).length,
        consultas_fonte_candidato: consultas.filter((c) => c.mudouApenasCategoria).length
      },
      residuos_after: residuos.length
    },
    breakdown: {
      por_coluna: porColuna,
      por_fonte: porFonte,
      por_candidato: porCandidato,
      por_celula: comparacoesCelulas,
      por_consulta_fonte_candidato: consultas
    },
    transicoes: {
      estado: transicoesEstado,
      proveniencia: transicoesProveniencia,
      resultado_fonte: transicoesFonte
    },
    residuos
  }
}

export function parseArgs(argv: string[]): OpcoesReconciliacao {
  const valor = (nome: string): string | undefined => {
    const prefixo = `--${nome}=`
    const comIgual = argv.find((arg) => arg.startsWith(prefixo))
    if (comIgual) return comIgual.slice(prefixo.length)
    const indice = argv.indexOf(`--${nome}`)
    return indice === -1 ? undefined : argv[indice + 1]
  }
  const obrigatorios = ["before-html", "before-snapshot", "after-html", "after-snapshot", "out"]
  const faltando = obrigatorios.filter((nome) => !valor(nome))
  if (faltando.length) throw new Error(`flags obrigatórias ausentes: ${faltando.join(", ")}`)
  return {
    beforeHtml: resolve(valor("before-html")!),
    beforeSnapshot: resolve(valor("before-snapshot")!),
    afterHtml: resolve(valor("after-html")!),
    afterSnapshot: resolve(valor("after-snapshot")!),
    out: resolve(valor("out")!)
  }
}

export function executar(opcoes: OpcoesReconciliacao): EvidenciaReconciliacao {
  const evidencia = reconciliarCobertura(
    readFileSync(opcoes.beforeHtml, "utf8"),
    JSON.parse(readFileSync(opcoes.beforeSnapshot, "utf8")),
    readFileSync(opcoes.afterHtml, "utf8"),
    JSON.parse(readFileSync(opcoes.afterSnapshot, "utf8")),
    opcoes
  )
  mkdirSync(dirname(opcoes.out), { recursive: true })
  writeFileSync(opcoes.out, JSON.stringify(evidencia, null, 2) + "\n")
  return evidencia
}

async function main(): Promise<void> {
  const opcoes = parseArgs(process.argv.slice(2))
  const evidencia = executar(opcoes)
  console.log(
    JSON.stringify({
      out: opcoes.out,
      candidatos: evidencia.metadata.observado.after.candidatos,
      celulas: evidencia.metadata.observado.after.celulas,
      residuos: evidencia.totais.residuos_after
    })
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : String(erro))
    process.exitCode = 1
  })
}
