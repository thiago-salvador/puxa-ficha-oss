import { supabase } from "./supabase"
import { loadCandidatos, fetchJSON, sleep, normalizeForMatch } from "./helpers"
import { log, warn } from "./logger"
import { registrarColetas } from "./coleta-log"
import type { IngestResult } from "./types"
import { motivoRecusaDeFonte } from "../../src/lib/public-attention-point"

const API = "https://api.portaldatransparencia.gov.br/api-de-dados"

/**
 * Incidente de 2026-08-04 (falso positivo em massa) e o que ele obriga.
 *
 * A versao anterior consultava `?cpfCnpj=<cpf>`. Esse parametro NAO EXISTE em
 * nenhum dos endpoints de sancao do Portal da Transparencia. A API ignora
 * parametro desconhecido em silencio e devolve a pagina 1 da lista nacional
 * inteira, entao cada candidato recebia os mesmos 15 registros de gente e
 * empresa sem nenhuma relacao com ele. Rodado em 27 candidatos, gravou 729
 * linhas falsas (27 x 27) com vinculo "direto". Revertido na mesma sessao.
 *
 * Reproducao (v3/api-docs + chamadas reais em 2026-08-04):
 *   ceis?cpfCnpj=00000000191      -> 15 registros (lista nacional, filtro ignorado)
 *   ceis?codigoSancionado=000...  -> 0 registros  (filtro correto e respeitado)
 *
 * Parametro correto por endpoint, conforme o swagger oficial:
 *   ceis  -> codigoSancionado (CPF ou CNPJ)
 *   cnep  -> codigoSancionado (CPF ou CNPJ)
 *   ceaf  -> cpfSancionado    (CPF)
 *   cepim -> cnpjSancionado   (CNPJ apenas; ver nota sobre CEPIM abaixo)
 *
 * CEPIM saiu do pipeline. O unico filtro documentado e por CNPJ e todo registro
 * devolvido e pessoa juridica (`pessoaJuridica.cnpjFormatado`), ou seja, o CPF
 * de um candidato nunca poderia casar. Antes da correcao, as linhas CEPIM eram
 * 100% ruido. Para religar, seria preciso ter o CNPJ de empresa ligada ao
 * candidato e gravar com vinculo diferente de "direto".
 *
 * Regra que passa a valer, e que este modulo aplica em duas camadas
 * independentes (nenhuma das duas confia na outra):
 *   1. Sem CPF valido, nao consulta e nao grava. Zero requisicao.
 *   2. Todo registro devolvido tem o documento conferido contra o CPF
 *      consultado. O que nao casa e descartado com aviso, mesmo que a API
 *      tenha dito que era resposta de uma consulta filtrada.
 *
 * Regressao: tests/ingest-transparencia-sanctions.test.ts
 */

export type SancaoTipo = "CEIS" | "CNEP" | "CEAF"

interface EndpointSancao {
  tipo: SancaoTipo
  path: string
  /** Nome do parametro de filtro por documento, conforme o swagger oficial. */
  paramDocumento: "codigoSancionado" | "cpfSancionado"
}

const ENDPOINTS: readonly EndpointSancao[] = [
  { tipo: "CEIS", path: "ceis", paramDocumento: "codigoSancionado" },
  { tipo: "CNEP", path: "cnep", paramDocumento: "codigoSancionado" },
  { tipo: "CEAF", path: "ceaf", paramDocumento: "cpfSancionado" },
]

// ---------------------------------------------------------------------------
// Formato real da resposta da API (v3/api-docs, conferido em 2026-08-04)
// ---------------------------------------------------------------------------

interface PessoaAPI {
  cpfFormatado?: string | null
  cnpjFormatado?: string | null
  nome?: string | null
}

interface FundamentacaoAPI {
  codigo?: string | null
  descricao?: string | null
}

/** CEIS e CNEP compartilham o mesmo DTO. */
interface RegistroCeisCnep {
  id?: number
  dataInicioSancao?: string | null
  dataFimSancao?: string | null
  tipoSancao?: { descricaoResumida?: string | null; descricaoPortal?: string | null } | null
  orgaoSancionador?: { nome?: string | null } | null
  sancionado?: { nome?: string | null; codigoFormatado?: string | null } | null
  pessoa?: PessoaAPI | null
  fundamentacao?: FundamentacaoAPI[] | null
  numeroProcesso?: string | null
}

interface RegistroCeaf {
  id?: number
  dataPublicacao?: string | null
  punicao?: {
    cpfPunidoFormatado?: string | null
    nomePunido?: string | null
    processo?: string | null
  } | null
  tipoPunicao?: { descricao?: string | null } | null
  pessoa?: PessoaAPI | null
  orgaoLotacao?: { nome?: string | null } | null
  fundamentacao?: FundamentacaoAPI[] | null
}

// ---------------------------------------------------------------------------
// Conferencia de documento (nucleo puro, coberto por teste)
// ---------------------------------------------------------------------------

export function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "")
}

/**
 * CPF valido de verdade: 11 digitos, nao todos iguais e com digitos
 * verificadores corretos.
 *
 * O gate e proposital: a maioria dos candidatos do seed ainda tem `cpf` nulo, e
 * o custo de consultar com lixo (ou com CPF mascarado vindo de outra fonte) e
 * exatamente o falso positivo que este modulo existe para impedir.
 */
export function cpfEhValido(valor: string | null | undefined): boolean {
  const cpf = somenteDigitos(valor)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digitoVerificador = (ateIndice: number): number => {
    let soma = 0
    let peso = ateIndice + 1
    for (let i = 0; i < ateIndice; i++) {
      soma += Number(cpf[i]) * peso
      peso--
    }
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  return digitoVerificador(9) === Number(cpf[9]) && digitoVerificador(10) === Number(cpf[10])
}

export type Conferencia = "exato" | "mascarado" | "nao-confere"

/**
 * Confere um documento devolvido pela API contra o CPF consultado.
 *
 * A API publica CPF de pessoa fisica mascarado (`***.435.151-**`): so os 6
 * digitos do meio aparecem. Nesse caso o casamento e parcial e o chamador ainda
 * precisa conferir o nome antes de aceitar. CNPJ (14 digitos) nunca casa com
 * CPF, e documento ausente nunca casa: o que nao da para conferir nao vira
 * linha no banco.
 */
export function conferirDocumento(
  cpfCandidato: string,
  valorRetornado: string | null | undefined
): Conferencia {
  const cpf = somenteDigitos(cpfCandidato)
  if (cpf.length !== 11) return "nao-confere"

  const bruto = (valorRetornado ?? "").trim()
  if (!bruto) return "nao-confere"

  const digitos = somenteDigitos(bruto)
  if (!digitos) return "nao-confere"

  if (bruto.includes("*")) {
    // Mascara do Portal: 6 digitos visiveis, posicoes 4 a 9 do CPF.
    if (digitos.length !== 6) return "nao-confere"
    return digitos === cpf.slice(3, 9) ? "mascarado" : "nao-confere"
  }

  if (digitos.length !== 11) return "nao-confere"
  return digitos === cpf ? "exato" : "nao-confere"
}

/**
 * Nomes batem o bastante para sustentar um casamento so por CPF mascarado.
 *
 * Aceita igualdade normalizada ou containment (nome de urna dentro do nome
 * completo). O piso de 8 caracteres evita que um sobrenome curto sozinho valide
 * um homonimo.
 */
export function nomesConferem(
  nomeCandidato: string | null | undefined,
  nomeRetornado: string | null | undefined
): boolean {
  const a = normalizeForMatch(nomeCandidato ?? "")
  const b = normalizeForMatch(nomeRetornado ?? "")
  if (a.length < 8 || b.length < 8) return false
  return a === b || a.includes(b) || b.includes(a)
}

/** "27/05/2025" -> "2025-05-27". "Sem informacao" e vazio viram null. */
export function parseDataBR(valor: string | null | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((valor ?? "").trim())
  if (!match) return null
  const [, dia, mes, ano] = match
  const iso = `${ano}-${mes}-${dia}`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

function juntarFundamentacao(itens: FundamentacaoAPI[] | null | undefined): string | null {
  if (!Array.isArray(itens)) return null
  const textos = itens
    .map((item) => (item?.descricao ?? item?.codigo ?? "").trim())
    .filter(Boolean)
  return textos.length > 0 ? textos.join("; ") : null
}

/** Sancao com fim no passado ja nao esta ativa. Sem data de fim, segue ativa. */
function estaAtiva(dataFimISO: string | null, hoje: Date): boolean {
  if (!dataFimISO) return true
  const fim = Date.parse(`${dataFimISO}T23:59:59Z`)
  return Number.isNaN(fim) ? true : fim >= hoje.getTime()
}

// ---------------------------------------------------------------------------
// Normalizacao dos registros
// ---------------------------------------------------------------------------

export interface SancaoNormalizada {
  tipo: SancaoTipo
  descricao: string
  orgaoSancionador: string | null
  dataInicio: string | null
  dataFim: string | null
  fundamentacao: string | null
  numeroProcesso: string | null
  ativo: boolean
  /** Como o documento do registro casou com o CPF consultado. */
  conferencia: "exato" | "mascarado"
}

export interface ContextoCandidato {
  cpf: string
  nome: string
}

export interface NormalizacaoResultado {
  aceitas: SancaoNormalizada[]
  descartes: string[]
}

/**
 * Decide se um registro pertence mesmo ao candidato consultado.
 *
 * Camada 2 da defesa: roda sobre a resposta ja filtrada pela API e nao confia
 * nela. Documento que nao casa, ou casamento so por mascara sem nome batendo,
 * e descartado.
 */
function conferirRegistro(
  ctx: ContextoCandidato,
  documentos: (string | null | undefined)[],
  nomesRetornados: (string | null | undefined)[]
): { ok: true; conferencia: "exato" | "mascarado" } | { ok: false; motivo: string } {
  let melhor: Conferencia = "nao-confere"
  for (const doc of documentos) {
    const resultado = conferirDocumento(ctx.cpf, doc)
    if (resultado === "exato") {
      melhor = "exato"
      break
    }
    if (resultado === "mascarado") melhor = "mascarado"
  }

  if (melhor === "nao-confere") {
    return { ok: false, motivo: "documento do registro nao casa com o CPF consultado" }
  }

  if (melhor === "mascarado") {
    const bateNome = nomesRetornados.some((nome) => nomesConferem(ctx.nome, nome))
    if (!bateNome) {
      return {
        ok: false,
        motivo: "CPF mascarado bateu, mas o nome do sancionado nao confere",
      }
    }
  }

  return { ok: true, conferencia: melhor }
}

export function normalizarRegistros(
  tipo: SancaoTipo,
  registros: unknown[],
  ctx: ContextoCandidato,
  hoje: Date = new Date()
): NormalizacaoResultado {
  const aceitas: SancaoNormalizada[] = []
  const descartes: string[] = []

  for (const bruto of registros) {
    if (!bruto || typeof bruto !== "object") {
      descartes.push(`${tipo}: registro em formato inesperado`)
      continue
    }

    if (tipo === "CEAF") {
      const reg = bruto as RegistroCeaf
      const conferencia = conferirRegistro(
        ctx,
        [reg.pessoa?.cpfFormatado, reg.punicao?.cpfPunidoFormatado],
        [reg.pessoa?.nome, reg.punicao?.nomePunido]
      )
      if (!conferencia.ok) {
        descartes.push(`${tipo}#${reg.id ?? "?"}: ${conferencia.motivo}`)
        continue
      }

      const dataPublicacao = parseDataBR(reg.dataPublicacao)
      aceitas.push({
        tipo,
        descricao: reg.tipoPunicao?.descricao?.trim() || "Punicao expulsiva (CEAF)",
        orgaoSancionador: reg.orgaoLotacao?.nome?.trim() || null,
        dataInicio: dataPublicacao,
        // Punicao expulsiva do CEAF nao tem data de fim no cadastro.
        dataFim: null,
        fundamentacao: juntarFundamentacao(reg.fundamentacao),
        numeroProcesso: reg.punicao?.processo?.trim() || null,
        ativo: true,
        conferencia: conferencia.conferencia,
      })
      continue
    }

    const reg = bruto as RegistroCeisCnep
    const conferencia = conferirRegistro(
      ctx,
      [reg.pessoa?.cpfFormatado, reg.sancionado?.codigoFormatado, reg.pessoa?.cnpjFormatado],
      [reg.pessoa?.nome, reg.sancionado?.nome]
    )
    if (!conferencia.ok) {
      descartes.push(`${tipo}#${reg.id ?? "?"}: ${conferencia.motivo}`)
      continue
    }

    const dataFim = parseDataBR(reg.dataFimSancao)
    aceitas.push({
      tipo,
      descricao:
        reg.tipoSancao?.descricaoResumida?.trim() ||
        reg.tipoSancao?.descricaoPortal?.trim() ||
        `Sanção ${tipo}`,
      orgaoSancionador: reg.orgaoSancionador?.nome?.trim() || null,
      dataInicio: parseDataBR(reg.dataInicioSancao),
      dataFim,
      fundamentacao: juntarFundamentacao(reg.fundamentacao),
      numeroProcesso: reg.numeroProcesso?.trim() || null,
      ativo: estaAtiva(dataFim, hoje),
      conferencia: conferencia.conferencia,
    })
  }

  return { aceitas, descartes }
}

// ---------------------------------------------------------------------------
// Coleta (rede injetavel, para o teste rodar sem API)
// ---------------------------------------------------------------------------

/**
 * Resposta de um cadastro, com a falha SEPARADA do vazio.
 *
 * A versao anterior devolvia `[]` nos dois casos, e era essa linha que produzia
 * o pior dado do banco: uma sancao real atras de um HTTP 500 chegava ao
 * chamador com exatamente a mesma cara de "este politico nao tem sancao
 * nenhuma". O ingest entao gravava zero, e o zero virava a ficha publica. Nao
 * da para afirmar que um cadastro esta vazio sem saber que ele respondeu.
 *
 * Isto e o ponto de injecao da rede, entao e aqui que a distincao precisa
 * existir: qualquer camada acima so consegue distinguir o que este tipo
 * distinguir.
 */
export type RespostaCadastro<T = unknown> =
  | { ok: true; registros: T[] }
  | { ok: false; erro: string }

export interface ColetaDeps {
  buscar(endpoint: EndpointSancao, documento: string): Promise<RespostaCadastro>
}

export interface ColetaResultado {
  /** false quando o guard de CPF barrou antes de qualquer requisicao. */
  consultou: boolean
  motivoSkip?: string
  sancoes: SancaoNormalizada[]
  descartes: string[]
  /**
   * Cadastros que nao responderam. Com um deles aqui, "sem sancao" e presuncao
   * e nao achado, e o ingest nao pode declarar `vazio_confirmado`.
   */
  falhas: string[]
}

/**
 * Camada 1 + camada 2 juntas: guard de CPF antes de consultar, conferencia de
 * documento em tudo que volta.
 */
export async function coletarSancoesDoCandidato(
  cpfBruto: string | null | undefined,
  nomeCandidato: string,
  deps: ColetaDeps,
  hoje: Date = new Date()
): Promise<ColetaResultado> {
  if (!cpfBruto || !somenteDigitos(cpfBruto)) {
    return { consultou: false, motivoSkip: "sem CPF", sancoes: [], descartes: [], falhas: [] }
  }
  if (!cpfEhValido(cpfBruto)) {
    return { consultou: false, motivoSkip: "CPF invalido", sancoes: [], descartes: [], falhas: [] }
  }

  const cpf = somenteDigitos(cpfBruto)
  const ctx: ContextoCandidato = { cpf, nome: nomeCandidato }
  const sancoes: SancaoNormalizada[] = []
  const descartes: string[] = []
  const falhas: string[] = []

  for (const endpoint of ENDPOINTS) {
    const resposta = await deps.buscar(endpoint, cpf)

    // Cadastro que nao respondeu nao vira zero: vira falha anotada. O chamador
    // segue com o que os outros trouxeram, como antes, mas fica impedido de
    // dizer que consultou tudo.
    if (!resposta.ok) {
      falhas.push(resposta.erro)
      continue
    }

    const registros = resposta.registros
    if (registros.length === 0) continue

    const { aceitas, descartes: descartados } = normalizarRegistros(
      endpoint.tipo,
      registros,
      ctx,
      hoje
    )
    sancoes.push(...aceitas)
    descartes.push(...descartados)
  }

  return { consultou: true, sancoes, descartes, falhas }
}

function criarDepsHttp(headers: Record<string, string>): ColetaDeps {
  return {
    async buscar(endpoint, documento) {
      try {
        const url = `${API}/${endpoint.path}?${endpoint.paramDocumento}=${encodeURIComponent(documento)}&pagina=1`
        const data = await fetchJSON<unknown[]>(url, headers)
        if (Array.isArray(data)) return { ok: true, registros: data }
        // Corpo fora do contrato nao e cadastro vazio: e resposta que nao
        // sabemos ler. Vai como falha, e nao como lista vazia, para que a
        // resposta ilegivel nunca passe por "candidato limpo".
        warn("transparencia-sanctions", `${endpoint.path}: resposta nao e lista`)
        return { ok: false, erro: `${endpoint.path}: resposta nao e lista` }
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err)
        warn("transparencia-sanctions", `${endpoint.path}: consulta falhou (${motivo})`)
        return { ok: false, erro: `${endpoint.path}: ${motivo}` }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

async function upsertSancao(candidatoId: string, sancao: SancaoNormalizada): Promise<boolean> {
  // O `eq("numero_processo", numeroProcesso ?? "")` da versao anterior nunca
  // casava com linha de processo nulo (NULL nao e igual a ''), entao cada
  // rodada duplicava. Aqui NULL e comparado com `is`.
  const base = supabase
    .from("sancoes_administrativas")
    .select("id")
    .eq("candidato_id", candidatoId)
    .eq("tipo", sancao.tipo)
  const query = sancao.numeroProcesso
    ? base.eq("numero_processo", sancao.numeroProcesso)
    : base.is("numero_processo", null)

  const { data: existentes } = await query.limit(1)

  const row = {
    candidato_id: candidatoId,
    tipo: sancao.tipo,
    descricao: sancao.descricao,
    orgao_sancionador: sancao.orgaoSancionador,
    data_inicio: sancao.dataInicio,
    data_fim: sancao.dataFim,
    fundamentacao: sancao.fundamentacao,
    // "direto" e honesto agora: a linha so existe porque o documento do
    // registro casou com o CPF do proprio candidato.
    vinculo: "direto" as const,
    numero_processo: sancao.numeroProcesso,
    ativo: sancao.ativo,
    fonte: "Portal da Transparencia",
  }

  const existente = existentes?.[0]
  if (existente) {
    const { error } = await supabase
      .from("sancoes_administrativas")
      .update(row)
      .eq("id", existente.id)
    return !error
  }

  const { error } = await supabase.from("sancoes_administrativas").insert(row)
  return !error
}

async function upsertPontoAtencao(
  candidatoId: string,
  tipo: SancaoTipo,
  descricao: string
): Promise<void> {
  const titulo = `Sanção administrativa ativa (${tipo})`
  const oldTitulo = `Sancao administrativa ativa (${tipo})`

  const { data: rows } = await supabase
    .from("pontos_atencao")
    .select("id, titulo, created_at")
    .eq("candidato_id", candidatoId)
    .eq("gerado_por", "automatico")
    .in("titulo", [titulo, oldTitulo])
    .order("created_at", { ascending: false })

  const row = {
    candidato_id: candidatoId,
    categoria: "corrupcao",
    titulo,
    descricao,
    gravidade: "alta",
    verificado: false,
    gerado_por: "automatico",
  }

  // Guard de fonte (auditoria de 2026-07-24, achados V1 e A3). Mesmo caso do
  // ingest-tcu: gravidade "alta" gravada sem nenhuma fonte, com gerado_por
  // "automatico" escapando do gate antigo. O gate de 20260725160000 recusa
  // este INSERT; aqui a gente para antes, com aviso legivel.
  //
  // Para religar: anexar em `fontes` a URL publica do Portal da Transparencia
  // que mostra a sancao (a rota consultada e a API autenticada, entao a fonte
  // exibida precisa ser a pagina publica equivalente, com caminho).
  const recusa = motivoRecusaDeFonte(row.gravidade, undefined)
  if (recusa) {
    warn("transparencia-sanctions", `ponto de atencao nao gravado (${recusa}): ${titulo}`)
    return
  }

  const existing = rows?.find((item) => item.titulo === titulo) ?? rows?.[0] ?? null
  const duplicateIds = (rows ?? [])
    .filter((item) => item.id !== existing?.id)
    .map((item) => item.id)

  if (existing) {
    await supabase.from("pontos_atencao").update(row).eq("id", existing.id)
    if (duplicateIds.length > 0) {
      await supabase.from("pontos_atencao").delete().in("id", duplicateIds)
    }
    return
  }

  await supabase.from("pontos_atencao").insert(row)
}

export async function ingestTransparenciaSanctions(): Promise<IngestResult[]> {
  const apiKey = process.env.TRANSPARENCIA_API_KEY
  if (!apiKey) {
    warn("transparencia-sanctions", "TRANSPARENCIA_API_KEY nao definida, pulando")

    // ESTE e o caminho que produziu 194 de 194 fichas com sancoes vazias,
    // incluindo politicos com cinco mandatos. Voltar aqui sem escrever nada era
    // indistinguivel, para quem le o banco depois, de ter consultado os
    // cadastros e nao ter achado nada. Uma linha de `erro` por candidato torna
    // a diferenca legivel: a ficha continua vazia, mas o relatorio passa a
    // dizer POR QUE esta vazia, e da para ver que falta credencial em vez de
    // concluir que 194 politicos tem ficha limpa.
    await registrarColetas(
      loadCandidatos().map((cand) => ({
        fonte: "transparencia-sanctions",
        alvo: cand.slug,
        resultado: "erro" as const,
        detalhe: "TRANSPARENCIA_API_KEY ausente: nenhum cadastro foi consultado",
      }))
    )
    return []
  }

  const headers = { "chave-api-dados": apiKey, Accept: "application/json" }
  const deps = criarDepsHttp(headers)
  const candidatos = loadCandidatos()
  const results: IngestResult[] = []

  for (const cand of candidatos) {
    const result: IngestResult = {
      source: "transparencia-sanctions",
      candidato: cand.slug,
      tables_updated: [],
      rows_upserted: 0,
      errors: [],
      duration_ms: 0,
    }

    const start = Date.now()
    log("transparencia-sanctions", `Processando ${cand.slug}`)

    try {
      const { data: dbCand } = await supabase
        .from("candidatos")
        .select("id, cpf, slug, nome_completo")
        .eq("slug", cand.slug)
        .single()

      if (!dbCand) {
        result.errors.push("Candidato nao encontrado no Supabase")
        result.duration_ms = Date.now() - start
        results.push(result)
        continue
      }

      const coleta = await coletarSancoesDoCandidato(
        dbCand.cpf,
        dbCand.nome_completo ?? cand.nome_completo,
        deps
      )

      if (!coleta.consultou) {
        warn(
          "transparencia-sanctions",
          `  ${cand.slug}: ${coleta.motivoSkip}, pulando sem consultar`
        )
        result.skipped = true
        result.skip_reason = coleta.motivoSkip
        // Sem CPF valido nao ha como consultar cadastro nenhum. Ficha vazia por
        // falta de pre-requisito nao e ficha limpa, entao vai como `erro` e nao
        // como vazio.
        result.coleta_resultado = "erro"
        result.coleta_detalhe = `${coleta.motivoSkip}: nenhum cadastro foi consultado`
        result.duration_ms = Date.now() - start
        results.push(result)
        // Sem requisicao feita, nao ha rate limit a respeitar.
        continue
      }

      for (const descarte of coleta.descartes) {
        warn("transparencia-sanctions", `  ${cand.slug}: registro descartado — ${descarte}`)
      }

      const candidatoId = dbCand.id
      let totalUpserted = 0
      const tiposComSancaoAtiva: SancaoTipo[] = []

      for (const sancao of coleta.sancoes) {
        const ok = await upsertSancao(candidatoId, sancao)
        if (!ok) continue
        totalUpserted++
        if (sancao.ativo && !tiposComSancaoAtiva.includes(sancao.tipo)) {
          tiposComSancaoAtiva.push(sancao.tipo)
        }
      }

      if (totalUpserted > 0) {
        result.tables_updated.push("sancoes_administrativas")
        result.rows_upserted += totalUpserted
      }

      if (tiposComSancaoAtiva.length > 0) {
        for (const tipo of tiposComSancaoAtiva) {
          const total = coleta.sancoes.filter((s) => s.tipo === tipo).length
          await upsertPontoAtencao(
            candidatoId,
            tipo,
            `${total} registro(s) do CPF deste candidato no cadastro ${tipo} do Portal da Transparencia`
          )
        }
        result.tables_updated.push("pontos_atencao")
        log(
          "transparencia-sanctions",
          `  ${cand.slug}: ${totalUpserted} sancao(oes) — ${tiposComSancaoAtiva.join(", ")}`
        )
      } else {
        log("transparencia-sanctions", `  ${cand.slug}: sem sancoes nos cadastros`)
      }

      // O veredito de coleta, que e o que separa a ficha limpa da ficha nao
      // consultada. So com todos os cadastros respondendo da para afirmar que
      // este politico nao tem sancao.
      //
      // A falha de cadastro NAO entra em `result.errors` de proposito: o
      // ingest-all faz process.exit(1) com qualquer erro ali, e uma
      // indisponibilidade parcial do Portal passaria a derrubar a ingestao
      // inteira, que nao e o comportamento de hoje e nao e decisao desta
      // mudanca. O `coleta_resultado` registra a verdade sem mexer no status do
      // pipeline.
      if (coleta.falhas.length > 0) {
        result.coleta_resultado = "erro"
        result.coleta_detalhe =
          `cadastro(s) sem resposta, zero nao confirmado: ${coleta.falhas.join("; ")}`.slice(0, 500)
        warn(
          "transparencia-sanctions",
          `  ${cand.slug}: ${coleta.falhas.length} cadastro(s) sem resposta, zero nao confirmado`
        )
      } else if (totalUpserted > 0) {
        result.coleta_resultado = "encontrado"
      } else {
        result.coleta_resultado = "vazio_confirmado"
        result.coleta_detalhe = `${ENDPOINTS.map((e) => e.tipo).join(", ")} responderam sem registro para o CPF`
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }

    result.duration_ms = Date.now() - start
    results.push(result)
    await sleep(1500)
  }

  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestTransparenciaSanctions().then((r) => console.log(JSON.stringify(r, null, 2)))
}
