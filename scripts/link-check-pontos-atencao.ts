/**
 * Link-check das fontes de `pontos_atencao`.
 *
 * Por que existe: a auditoria de 2026-07-24 encontrou 18 afirmações graves
 * publicadas cuja única fonte devolvia HTTP 404, 17 delas marcadas como
 * verificadas (achado V1 de docs/auditoria-integridade-2026-07-24.md). O gate
 * SQL de 20260725160000 impede que uma claim grave nasça sem fonte utilizável,
 * mas não impede que a URL morra depois. Este script é a rede que pega isso.
 *
 * O QUE MUDOU NA ETAPA 5B (2026-07-25)
 *
 * A primeira versão tratava HTTP 200 como sinal de saúde. Não basta, e a
 * verificação provou três buracos:
 *
 *   1. `https://divulgacandcontas.tse.jus.br/divulga/` responde 200 e entrega
 *      46 caracteres. É a casca do SPA do TSE e sustentava uma claim de
 *      gravidade alta sobre o patrimônio de uma pessoa nomeada.
 *   2. `noticias.stf.jus.br` responde 200 na primeira requisição e 202 com
 *      corpo vazio nas seguintes. Limitador de taxa, não página morta.
 *   3. Vedação eleitoral. Nesta data, portais oficiais brasileiros estão fora
 *      do ar por lei (`agenciaminas.mg.gov.br` com 503 e aviso explícito,
 *      páginas de notícia de `goias.gov.br` com o aviso no lugar da matéria).
 *      Um link-check ingênuo despublicaria fonte legítima.
 *
 * Por isso o estado de uma URL agora tem cinco valores, e só um deles
 * despublica:
 *
 *   viva            responde e entrega conteúdo que dá para ler
 *   sem_substancia  responde, mas o corpo é casca de SPA, índice ou curto
 *                   demais para sustentar qualquer afirmação. ALERTA, não
 *                   despublica: quem decide se a claim cai é humano.
 *   indisponivel    fora do ar temporariamente (bloqueio de robô, 5xx,
 *                   timeout, corpo vazio com 2xx, vedação eleitoral).
 *                   NUNCA despublica.
 *   morta           404, 410 ou DNS inexistente. Só isso conta como morte.
 *   sem_caminho     domínio nu ou raiz de portal, defeito de formato que o
 *                   gate SQL já recusa na escrita.
 *
 * Despublicação continua exigindo que TODAS as fontes da claim estejam mortas,
 * e agora também que nenhuma delas seja de domínio da lista de verificação
 * manual (`DOMINIOS_VERIFICACAO_MANUAL` em src/lib/fonte-substancia.ts).
 *
 * O QUE MUDOU EM 2026-07-29: DOIS NÍVEIS DE ALARME
 *
 * A primeira execução com credencial no CI reprovou 71 claims e 36 URLs
 * mortas. Cruzando com `candidatos_publico`, só 7 dessas claims estavam em
 * ficha de candidato de fato publicado, e as 7 tinham TODAS as fontes
 * `indisponivel`, o veredito que este arquivo já declarava como temporário.
 * Ou seja: o job ficaria vermelho toda semana sem que nada estivesse errado na
 * superfície pública. Gate que grita sem motivo é gate que alguém silencia, e
 * aí ele não pega o dia em que o problema for real.
 *
 * Duas correções, e nenhuma delas afrouxa a checagem:
 *
 *   1. `visivel = true` no ponto de atenção NÃO significa que a claim aparece
 *      no site. O candidato dono dela também precisa estar em
 *      `candidatos_publico`. O campo `publico` da linha carrega esse fato, e
 *      `--gate-somente-publicos` restringe o CRITÉRIO DE FALHA ao recorte que
 *      o leitor enxerga. A checagem continua rodando sobre tudo, e o que ficou
 *      de fora do recorte público continua no relatório: esse conjunto é a
 *      fila de publicação, e checá-lo só depois de publicar seria checar tarde
 *      demais.
 *   2. Claim cujas fontes são todas `indisponivel` deixa de contar como
 *      defeito. Vira aviso. Falha exige defeito REAL de sourcing, isto é ao
 *      menos uma fonte `morta`, `sem_caminho` ou `sem_substancia`. É o que o
 *      cabeçalho acima já dizia sobre despublicação, aplicado também ao gate.
 *
 * Modos:
 *   --dry-run   (padrão) só reporta, nunca escreve
 *   --apply     despublica (visivel = false) a claim cujas fontes estão TODAS
 *               mortas. Nunca deleta nada.
 *
 * Uso:
 *   npx tsx scripts/link-check-pontos-atencao.ts --dry-run
 *   npx tsx scripts/link-check-pontos-atencao.ts --dry-run --fail-on-dead
 *   npx tsx scripts/link-check-pontos-atencao.ts --dry-run --fail-on-sem-substancia
 *   npx tsx scripts/link-check-pontos-atencao.ts --apply
 *
 * Flags extras: --limit=N, --timeout=MS, --concurrency=N, --host-delay=MS,
 * --max-bytes=N, --only-visible, --gate-somente-publicos,
 * --revalidar=slug1,slug2
 *
 * GATE DE REVALIDAÇÃO ANTES DE PUBLICAR (2026-08-02)
 *
 * `--revalidar=` trata os slugs nomeados como se já fossem públicos, só para
 * efeito do critério de falha. Serve ao caso que o gate normal não cobre: o
 * candidato que está fora da coorte hoje (`removido`, `desistente`, ou nunca
 * publicado) e vai entrar. Decisão do Thiago no mesmo dia: claim de quem está
 * fora não é despublicada preventivamente, mas a fonte tem que ser revalidada
 * ANTES da volta, senão a claim reaparece junto com a fonte podre.
 *
 * Uso na publicação:
 *   npm run data:link-check-fontes:revalidar -- --revalidar=ciro-gomes,aldo-rebelo
 *
 * Exit code 1 = não publique esses candidatos ainda.
 */

import { pathToFileURL } from "node:url"
import { supabase } from "./lib/supabase"
import { log as baseLog, warn as baseWarn, error as baseError } from "./lib/logger"
import { fonteUrlApontaParaDocumento } from "../src/lib/public-attention-point"
import { analisarSubstancia, dominioExigeVerificacaoManual } from "../src/lib/fonte-substancia"

const SOURCE = "link-check"

const NAVIGATOR_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export type UrlStatus = "viva" | "morta" | "indisponivel" | "sem_substancia" | "sem_caminho"

export interface UrlProbe {
  url: string
  status: UrlStatus
  httpStatus: number | null
  detalhe: string
}

export interface PontoAtencaoLinkRow {
  id: string
  candidato_id: string | null
  titulo: string
  gravidade: string | null
  visivel: boolean | null
  fontes: unknown
  dados_relacionados: unknown
  /**
   * O candidato dono da claim está em `candidatos_publico`, ou seja, a ficha
   * existe para o leitor. Ausente ou `undefined` é tratado como `true` de
   * propósito: na dúvida sobre o alcance, o alarme fala mais alto, não menos.
   */
  publico?: boolean
}

export interface LinkCheckDeps {
  apply: boolean
  onlyVisible: boolean
  limit: number | null
  fetchRows: () => Promise<PontoAtencaoLinkRow[]>
  /**
   * Recebe a lista inteira de URLs de uma vez, e não uma por vez, porque o
   * agendamento correto é por host: paralelo entre servidores, fila com pausa
   * dentro de cada servidor. Ver `mapPorHost`.
   */
  probeUrls: (urls: string[]) => Promise<UrlProbe[]>
  despublicar: (row: PontoAtencaoLinkRow, motivo: string) => Promise<void>
  log: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  agora: () => Date
}

export interface ClaimVeredito {
  id: string
  titulo: string
  gravidade: string | null
  visivel: boolean
  /** Ver `PontoAtencaoLinkRow.publico`. */
  publico: boolean
  total: number
  vivas: number
  mortas: number
  indisponiveis: number
  semSubstancia: number
  semCaminho: number
  urlsMortas: string[]
  urlsSemSubstancia: string[]
}

export interface LinkCheckResult {
  claims: number
  urlsUnicas: number
  urlsVivas: number
  urlsMortas: number
  urlsIndisponiveis: number
  urlsSemSubstancia: number
  urlsSemCaminho: number
  claimsTotalmenteMortas: ClaimVeredito[]
  claimsParcialmenteMortas: ClaimVeredito[]
  claimsSemFonteComConteudo: ClaimVeredito[]
  /**
   * Subconjunto de `claimsSemFonteComConteudo` com defeito REAL de sourcing
   * (ao menos uma fonte morta, sem caminho ou sem substância). Claim cujas
   * fontes estão todas apenas `indisponivel` fica de fora: é temporária por
   * definição e volta sozinha.
   */
  claimsSemFonteUtilizavel: ClaimVeredito[]
  /** Claims visíveis com ao menos uma fonte morta, total ou parcialmente. */
  claimsComFonteMorta: ClaimVeredito[]
  despublicadas: number
  bloqueadasPorVerificacaoManual: number
  erros: number
}

function urlsDaFonte(fontes: unknown): string[] {
  if (!Array.isArray(fontes)) return []
  const out: string[] = []
  for (const fonte of fontes) {
    if (!fonte || typeof fonte !== "object") continue
    const url = (fonte as { url?: unknown }).url
    if (typeof url === "string" && url.trim() !== "") out.push(url.trim())
  }
  return out
}

/**
 * Classificação da resposta HTTP. Mantida separada do fetch para poder ser
 * testada sem rede. Só olha o status: substância do corpo é decidida por
 * `analisarSubstancia`.
 */
export function classificarHttp(httpStatus: number): UrlStatus {
  if (httpStatus >= 200 && httpStatus < 400) return "viva"
  if (httpStatus === 404 || httpStatus === 410) return "morta"
  return "indisponivel"
}

/** Erro de rede que prova ausência do recurso, e não bloqueio ou instabilidade. */
export function erroDeRedeEhMorte(mensagem: string): boolean {
  return /ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(mensagem)
}

/** Host de uma URL, usado para serializar as requisições por servidor. */
export function hostDaUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return url
  }
}

export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Lê no máximo `maxBytes` do corpo. Sem isso, um PDF de diário oficial ou um
 * ZIP do TSE entrariam inteiros na memória só para medir tamanho.
 */
async function lerCorpoLimitado(res: Response, maxBytes: number): Promise<{ corpo: string; bytes: number }> {
  const body = res.body
  if (!body) {
    const corpo = await res.text()
    return { corpo, bytes: Buffer.byteLength(corpo) }
  }

  const reader = body.getReader()
  const pedacos: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes <= maxBytes) pedacos.push(value)
      else {
        pedacos.push(value.subarray(0, Math.max(0, maxBytes - (bytes - value.byteLength))))
        await reader.cancel()
        break
      }
    }
  } catch {
    // Corpo truncado pelo servidor: o que já veio vale para medir substância.
  }

  return { corpo: Buffer.concat(pedacos).toString("utf-8"), bytes }
}

export interface ProbeOpcoes {
  timeoutMs: number
  maxBytes: number
  /** Espera antes de repetir uma URL que voltou vazia ou com desafio. */
  retryDelayMs: number
}

/**
 * Sonda uma URL de verdade. Exportada para poder ser exercitada contra a rede
 * fora do fluxo do banco (ver o bloco de verificacao no relatorio da etapa 5B).
 */
export async function probeUrlReal(url: string, opcoes: ProbeOpcoes): Promise<UrlProbe> {
  if (!fonteUrlApontaParaDocumento(url)) {
    return {
      url,
      status: "sem_caminho",
      httpStatus: null,
      detalhe: "dominio nu ou raiz de portal, nao aponta para documento nenhum",
    }
  }

  const primeira = await requisitar(url, opcoes)

  // Corpo vazio ou desafio anti-robô na primeira tentativa costuma ser
  // limitador de taxa. Uma segunda tentativa depois de uma pausa distingue
  // "servidor cansado" de "servidor sempre assim", e foi exatamente o que
  // separou `noticias.stf.jus.br` (vivo) de página morta em 2026-07-25.
  if (primeira.status === "indisponivel" && opcoes.retryDelayMs > 0) {
    await esperar(opcoes.retryDelayMs)
    const segunda = await requisitar(url, opcoes)
    if (segunda.status !== "indisponivel") return segunda
    return { ...segunda, detalhe: `${segunda.detalhe} (2 tentativas)` }
  }

  return primeira
}

async function requisitar(url: string, opcoes: ProbeOpcoes): Promise<UrlProbe> {
  const headers = {
    "User-Agent": NAVIGATOR_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opcoes.timeoutMs)

  try {
    // Sempre GET. HEAD economiza banda mas não devolve corpo, e sem corpo não
    // dá para saber se a página sustenta a afirmação, que é o ponto deste
    // script depois da etapa 5B.
    const res = await fetch(url, { method: "GET", redirect: "follow", headers, signal: controller.signal })
    const porStatus = classificarHttp(res.status)

    if (porStatus !== "viva") {
      return { url, status: porStatus, httpStatus: res.status, detalhe: `GET ${res.status}` }
    }

    const { corpo, bytes } = await lerCorpoLimitado(res, opcoes.maxBytes)
    const analise = analisarSubstancia({
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      corpo,
      bytes,
    })

    const status: UrlStatus =
      analise.veredito === "com_conteudo"
        ? "viva"
        : analise.veredito === "sem_substancia"
          ? "sem_substancia"
          : "indisponivel"

    return { url, status, httpStatus: res.status, detalhe: `GET ${res.status}, ${analise.motivo}` }
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e)
    if (erroDeRedeEhMorte(mensagem)) {
      return { url, status: "morta", httpStatus: null, detalhe: `DNS: ${mensagem}` }
    }
    return { url, status: "indisponivel", httpStatus: null, detalhe: `rede: ${mensagem}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Roda `fn` sobre as URLs com paralelismo entre hosts e fila sequencial dentro
 * de cada host, com pausa entre requisições ao mesmo servidor.
 *
 * Isso não é gentileza: rajada contra `noticias.stf.jus.br` produz 202 com
 * corpo vazio, ou seja, o próprio robô fabrica o falso negativo que depois vai
 * despublicar claim boa.
 */
export async function mapPorHost<R>(
  urls: string[],
  concurrency: number,
  hostDelayMs: number,
  fn: (url: string) => Promise<R>,
): Promise<R[]> {
  const indicePorUrl = new Map(urls.map((url, i) => [url, i]))
  const porHost = new Map<string, string[]>()
  for (const url of urls) {
    const host = hostDaUrl(url)
    const lista = porHost.get(host)
    if (lista) lista.push(url)
    else porHost.set(host, [url])
  }

  const filas = [...porHost.values()]
  const results: R[] = new Array(urls.length)
  let cursor = 0

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, filas.length)) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= filas.length) return
      const fila = filas[index]!
      for (let i = 0; i < fila.length; i++) {
        if (i > 0 && hostDelayMs > 0) await esperar(hostDelayMs)
        const url = fila[i]!
        results[indicePorUrl.get(url)!] = await fn(url)
      }
    }
  })

  await Promise.all(workers)
  return results
}

export async function runLinkCheck(deps: LinkCheckDeps): Promise<LinkCheckResult> {
  const { apply, onlyVisible, limit, log, warn, error, agora } = deps

  let rows = await deps.fetchRows()
  if (onlyVisible) rows = rows.filter((row) => row.visivel === true)
  if (limit !== null) rows = rows.slice(0, limit)

  const urls = [...new Set(rows.flatMap((row) => urlsDaFonte(row.fontes)))]
  log(`${rows.length} pontos de atencao, ${urls.length} URLs unicas a testar.`)

  const probes = await deps.probeUrls(urls)
  const porUrl = new Map(probes.map((probe) => [probe.url, probe]))

  const claimsTotalmenteMortas: ClaimVeredito[] = []
  const claimsParcialmenteMortas: ClaimVeredito[] = []
  const claimsSemFonteComConteudo: ClaimVeredito[] = []
  const claimsComFonteMorta: ClaimVeredito[] = []

  for (const row of rows) {
    const lista = urlsDaFonte(row.fontes)
    if (lista.length === 0) continue

    const status = lista.map((url) => porUrl.get(url)?.status ?? "indisponivel")
    const veredito: ClaimVeredito = {
      id: row.id,
      titulo: row.titulo,
      gravidade: row.gravidade,
      visivel: row.visivel === true,
      publico: row.publico !== false,
      total: lista.length,
      vivas: status.filter((s) => s === "viva").length,
      mortas: status.filter((s) => s === "morta").length,
      indisponiveis: status.filter((s) => s === "indisponivel").length,
      semSubstancia: status.filter((s) => s === "sem_substancia").length,
      semCaminho: status.filter((s) => s === "sem_caminho").length,
      urlsMortas: lista.filter((_, i) => status[i] === "morta"),
      urlsSemSubstancia: lista.filter((_, i) => status[i] === "sem_substancia"),
    }

    // Claim publicada sem nenhuma fonte que entregue conteúdo é o caso do
    // Caiado: HTTP 200 em tudo, zero prova. Vira alerta, nunca despublicação
    // automática, porque a causa pode ser vedação eleitoral ou bloqueio de
    // robô, e nesses dois casos a fonte volta sozinha.
    if (veredito.vivas === 0 && veredito.visivel) claimsSemFonteComConteudo.push(veredito)

    if (veredito.mortas === 0) continue
    if (veredito.visivel) claimsComFonteMorta.push(veredito)
    // "Todas mortas" exige zero vivas, zero indisponíveis e zero sem
    // substância: fonte que só bloqueou robô ou que está sob vedação eleitoral
    // não pode contribuir para tirar a claim do ar.
    if (veredito.mortas === veredito.total) claimsTotalmenteMortas.push(veredito)
    else claimsParcialmenteMortas.push(veredito)
  }

  let despublicadas = 0
  let bloqueadasPorVerificacaoManual = 0
  let erros = 0

  for (const veredito of claimsTotalmenteMortas) {
    const linha = `${veredito.id} [${veredito.gravidade ?? "sem gravidade"}] "${veredito.titulo}" -> ${veredito.urlsMortas.join(", ")}`

    if (!veredito.visivel) {
      log(`ja fora do ar, nada a fazer: ${linha}`)
      continue
    }

    const manuais = veredito.urlsMortas.filter((url) => dominioExigeVerificacaoManual(url))
    if (manuais.length > 0) {
      bloqueadasPorVerificacaoManual += 1
      warn(
        `NAO despublicado por exigir verificacao humana (dominio que responde de forma intermitente): ` +
          `${linha}. Dominios: ${manuais.join(", ")}`,
      )
      continue
    }

    if (!apply) {
      warn(`[dry-run] sairia do ar: ${linha}`)
      continue
    }

    const motivo =
      `Link-check de ${agora().toISOString().slice(0, 10)}: todas as ${veredito.total} fontes retornaram morta ` +
      `(${veredito.urlsMortas.join(", ")}). Despublicado automaticamente por scripts/link-check-pontos-atencao.ts.`

    try {
      const row = rows.find((r) => r.id === veredito.id)!
      await deps.despublicar(row, motivo)
      despublicadas += 1
      log(`despublicado: ${linha}`)
    } catch (e) {
      erros += 1
      error(`falha ao despublicar ${veredito.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  for (const veredito of claimsParcialmenteMortas) {
    warn(
      `fonte morta mas claim mantida (ainda tem ${veredito.vivas} viva(s), ${veredito.indisponiveis} indisponivel(is) e ` +
        `${veredito.semSubstancia} sem substancia): ${veredito.id} "${veredito.titulo}" -> ${veredito.urlsMortas.join(", ")}`,
    )
  }

  for (const veredito of claimsSemFonteComConteudo) {
    warn(
      `claim PUBLICADA sem nenhuma fonte com conteudo recuperavel ` +
        `(${veredito.vivas} viva, ${veredito.semSubstancia} sem substancia, ${veredito.indisponiveis} indisponivel, ` +
        `${veredito.mortas} morta, ${veredito.semCaminho} sem caminho): ` +
        `${veredito.id} [${veredito.gravidade ?? "sem gravidade"}] "${veredito.titulo}"` +
        (veredito.urlsSemSubstancia.length > 0 ? ` -> ${veredito.urlsSemSubstancia.join(", ")}` : ""),
    )
  }

  const resultado: LinkCheckResult = {
    claims: rows.length,
    urlsUnicas: urls.length,
    urlsVivas: probes.filter((p) => p.status === "viva").length,
    urlsMortas: probes.filter((p) => p.status === "morta").length,
    urlsIndisponiveis: probes.filter((p) => p.status === "indisponivel").length,
    urlsSemSubstancia: probes.filter((p) => p.status === "sem_substancia").length,
    urlsSemCaminho: probes.filter((p) => p.status === "sem_caminho").length,
    claimsTotalmenteMortas,
    claimsParcialmenteMortas,
    claimsSemFonteComConteudo,
    claimsSemFonteUtilizavel: claimsSemFonteComConteudo.filter(temDefeitoRealDeFonte),
    claimsComFonteMorta,
    despublicadas,
    bloqueadasPorVerificacaoManual,
    erros,
  }

  const noFront = (v: ClaimVeredito) => v.publico
  const foraDoFront = (v: ClaimVeredito) => !v.publico

  log(
    `${apply ? "Aplicado." : "Dry-run. Nenhuma escrita."}\n` +
      `  Pontos de atencao analisados: ${resultado.claims}\n` +
      `  URLs unicas: ${resultado.urlsUnicas}\n` +
      `  Vivas: ${resultado.urlsVivas} | Mortas: ${resultado.urlsMortas} | ` +
      `Indisponiveis: ${resultado.urlsIndisponiveis} | Sem substancia: ${resultado.urlsSemSubstancia} | ` +
      `Sem caminho: ${resultado.urlsSemCaminho}\n` +
      `  Claims com TODAS as fontes mortas: ${resultado.claimsTotalmenteMortas.length}\n` +
      `  Claims com fonte morta mas nao todas: ${resultado.claimsParcialmenteMortas.length}\n` +
      `  Claims publicadas sem fonte com conteudo: ${resultado.claimsSemFonteComConteudo.length}\n` +
      `    destas, com defeito real de fonte: ${resultado.claimsSemFonteUtilizavel.length} ` +
      `(o resto e indisponibilidade temporaria)\n` +
      `  EM FICHA PUBLICA (o que o leitor ve agora):\n` +
      `    com fonte morta: ${resultado.claimsComFonteMorta.filter(noFront).length}\n` +
      `    sem fonte utilizavel: ${resultado.claimsSemFonteUtilizavel.filter(noFront).length}\n` +
      `  FILA DE PUBLICACAO (candidato fora do front, corrigir ANTES de publicar):\n` +
      `    com fonte morta: ${resultado.claimsComFonteMorta.filter(foraDoFront).length}\n` +
      `    sem fonte utilizavel: ${resultado.claimsSemFonteUtilizavel.filter(foraDoFront).length}\n` +
      `  Despublicadas nesta execucao: ${resultado.despublicadas}\n` +
      `  Retidas para verificacao humana: ${resultado.bloqueadasPorVerificacaoManual}\n` +
      `  Erros de escrita: ${resultado.erros}`,
  )

  return resultado
}

/**
 * Defeito real de sourcing, em oposição a indisponibilidade temporária.
 *
 * `indisponivel` cobre bloqueio de robô, 5xx, timeout e vedação eleitoral: a
 * fonte volta sozinha, e por isso este arquivo nunca despublica com base nela.
 * O gate segue a mesma doutrina. Já `morta`, `sem_caminho` e `sem_substancia`
 * descrevem fonte que não sustenta a afirmação, e nenhuma delas se resolve com
 * o tempo.
 */
export function temDefeitoRealDeFonte(veredito: ClaimVeredito): boolean {
  return veredito.mortas > 0 || veredito.semCaminho > 0 || veredito.semSubstancia > 0
}

function parseNumberFlag(prefixo: string, padrao: number | null): number | null {
  const arg = process.argv.find((a) => a.startsWith(prefixo))
  if (!arg) return padrao
  const valor = Number(arg.slice(prefixo.length))
  return Number.isFinite(valor) && valor > 0 ? valor : padrao
}

/** Lista separada por vírgula, vazia quando a flag não veio. */
export function parseListaFlag(prefixo: string, argv: readonly string[]): string[] {
  const arg = argv.find((a) => a.startsWith(prefixo))
  if (!arg) return []
  return arg
    .slice(prefixo.length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Escrita da despublicação.
 *
 * As colunas `despublicacao_motivo` e `despublicado_em` chegam na migration
 * 20260725153000. Enquanto ela não for aplicada, o motivo vai para
 * `dados_relacionados`, do mesmo jeito que as migrations da etapa 1A/1B
 * fizeram. O fallback é detectado pela mensagem do Postgres, não presumido.
 */
async function despublicarNoBanco(row: PontoAtencaoLinkRow, motivo: string): Promise<void> {
  const dados =
    row.dados_relacionados && typeof row.dados_relacionados === "object" && !Array.isArray(row.dados_relacionados)
      ? (row.dados_relacionados as Record<string, unknown>)
      : {}

  const dadosComMotivo = {
    ...dados,
    link_check_despublicacao: { motivo, em: new Date().toISOString() },
  }

  const comColunas = await supabase
    .from("pontos_atencao")
    .update({
      visivel: false,
      dados_relacionados: dadosComMotivo,
      despublicacao_motivo: motivo,
      despublicado_em: new Date().toISOString(),
    })
    .eq("id", row.id)

  if (!comColunas.error) return

  const mensagem = comColunas.error.message
  if (!/despublicacao_motivo|despublicado_em|column .* does not exist/i.test(mensagem)) {
    throw new Error(mensagem)
  }

  baseWarn(
    SOURCE,
    "colunas despublicacao_motivo/despublicado_em ausentes (migration 20260725153000 nao aplicada). Gravando motivo em dados_relacionados.",
  )

  const semColunas = await supabase
    .from("pontos_atencao")
    .update({ visivel: false, dados_relacionados: dadosComMotivo })
    .eq("id", row.id)

  if (semColunas.error) throw new Error(semColunas.error.message)
}

/**
 * Ids dos candidatos que o leitor de fato alcança. `candidatos_publico` é a
 * mesma view que o app consulta, então o recorte aqui é o recorte do site, e
 * não uma segunda definição de "público" que poderia divergir com o tempo.
 */
/**
 * Ids dos candidatos nomeados em `--revalidar=slug,slug`.
 *
 * Existe por causa da decisão do Thiago de 2026-08-02: claim de candidato fora
 * da coorte (`removido`, `desistente`) NÃO é despublicada preventivamente, mas
 * a fonte tem que ser revalidada ANTES de o candidato voltar a `candidatos_publico`.
 *
 * Sem isto o gate só olha quem já é público, o que é tarde demais: no instante
 * em que o candidato volta, a claim vai junto, com a fonte podre que ninguém
 * checou. Marcar o slug como público durante a checagem faz o critério de falha
 * do `--gate-somente-publicos` valer para ele antes da publicação, que é
 * exatamente o momento útil. Vale igual para candidato novo entrando na coorte.
 *
 * Lê de `candidatos` (não da view), porque o alvo é justamente quem ainda não
 * está na view.
 */
async function idsDosSlugs(slugs: readonly string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set()
  const { data, error: err } = await supabase.from("candidatos").select("id, slug").in("slug", slugs)
  if (err) throw new Error(`candidatos por slug: ${err.message}`)
  const linhas = (data ?? []) as Array<{ id: string; slug: string }>
  const achados = new Set(linhas.map((l) => l.slug))
  const faltando = slugs.filter((s) => !achados.has(s))
  if (faltando.length > 0) {
    // Slug errado silenciosamente checaria nada e passaria verde, que é o pior
    // resultado possível num gate de publicação.
    throw new Error(`--revalidar: slug(s) inexistente(s) em candidatos: ${faltando.join(", ")}`)
  }
  return new Set(linhas.map((l) => l.id))
}

async function idsDeCandidatosPublicos(): Promise<Set<string>> {
  const pageSize = 1000
  const ids = new Set<string>()
  for (let from = 0; ; from += pageSize) {
    const { data, error: err } = await supabase
      .from("candidatos_publico")
      .select("id")
      .order("id")
      .range(from, from + pageSize - 1)

    if (err) throw new Error(`candidatos_publico: ${err.message}`)
    const pagina = (data ?? []) as Array<{ id: string }>
    for (const linha of pagina) ids.add(linha.id)
    if (pagina.length < pageSize) break
  }
  return ids
}

async function main() {
  const apply = process.argv.includes("--apply")
  const onlyVisible = process.argv.includes("--only-visible")
  const failOnDead = process.argv.includes("--fail-on-dead")
  const failOnSemSubstancia = process.argv.includes("--fail-on-sem-substancia")
  const gateSomentePublicos = process.argv.includes("--gate-somente-publicos")
  const slugsRevalidacao = parseListaFlag("--revalidar=", process.argv)
  const limit = parseNumberFlag("--limit=", null)
  const timeoutMs = parseNumberFlag("--timeout=", 20000) ?? 20000
  const concurrency = parseNumberFlag("--concurrency=", 6) ?? 6
  const hostDelayMs = parseNumberFlag("--host-delay=", 1500) ?? 1500
  const maxBytes = parseNumberFlag("--max-bytes=", 512 * 1024) ?? 512 * 1024

  if (apply && process.argv.includes("--dry-run")) {
    throw new Error("--apply e --dry-run sao mutuamente exclusivos")
  }

  const opcoes: ProbeOpcoes = { timeoutMs, maxBytes, retryDelayMs: Math.max(hostDelayMs, 5000) }

  const resultado = await runLinkCheck({
    apply,
    onlyVisible,
    limit,
    async fetchRows() {
      const publicos = await idsDeCandidatosPublicos()
      // Modo revalidação: trata os slugs pedidos como se já fossem públicos, para
      // que o critério de falha do gate caia sobre eles ANTES de entrarem na
      // coorte. Ver `idsDosSlugs` para o porquê.
      const revalidar = await idsDosSlugs(slugsRevalidacao)
      const pageSize = 500
      const todas: PontoAtencaoLinkRow[] = []
      for (let from = 0; ; from += pageSize) {
        const { data, error: err } = await supabase
          .from("pontos_atencao")
          .select("id, candidato_id, titulo, gravidade, visivel, fontes, dados_relacionados")
          .order("id")
          .range(from, from + pageSize - 1)

        if (err) throw new Error(err.message)
        const pagina = (data ?? []) as PontoAtencaoLinkRow[]
        todas.push(
          ...pagina.map((row) => ({
            ...row,
            publico:
              row.candidato_id !== null &&
              (publicos.has(row.candidato_id) || revalidar.has(row.candidato_id)),
          })),
        )
        if (pagina.length < pageSize) break
      }
      return todas
    },
    probeUrls: (urls) => mapPorHost(urls, concurrency, hostDelayMs, (url) => probeUrlReal(url, opcoes)),
    despublicar: despublicarNoBanco,
    log: (message) => baseLog(SOURCE, message),
    warn: (message) => baseWarn(SOURCE, message),
    error: (message) => baseError(SOURCE, message),
    agora: () => new Date(),
  })

  if (resultado.erros > 0) process.exitCode = 1

  // Com --gate-somente-publicos, só derruba o job o que o leitor alcança hoje.
  // O resto continua no relatório acima como fila de publicação: é dívida a
  // pagar antes de publicar o candidato, não incidente da semana.
  const noEscopo = (veredito: ClaimVeredito) => !gateSomentePublicos || veredito.publico

  const mortasNoEscopo = resultado.claimsComFonteMorta.filter(noEscopo)
  if (failOnDead && mortasNoEscopo.length > 0) {
    baseError(
      SOURCE,
      `${mortasNoEscopo.length} claim(s) visivel(is) com fonte morta` +
        `${gateSomentePublicos ? " em ficha publica" : ""} e --fail-on-dead esta ligado.`,
    )
    process.exitCode = 1
  }

  const semFonteNoEscopo = resultado.claimsSemFonteUtilizavel.filter(noEscopo)
  if (failOnSemSubstancia && semFonteNoEscopo.length > 0) {
    baseError(
      SOURCE,
      `${semFonteNoEscopo.length} claim(s) publicada(s) sem nenhuma fonte utilizavel` +
        `${gateSomentePublicos ? " em ficha publica" : ""} e --fail-on-sem-substancia esta ligado.`,
    )
    process.exitCode = 1
  }
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isDirectRun) {
  main().catch((e) => {
    baseError(SOURCE, e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
