/**
 * Análise de SUBSTÂNCIA de uma fonte, além do status HTTP.
 *
 * Por que existe: a auditoria de 2026-07-25 mostrou que "HTTP 200" não prova
 * nada sobre a afirmação publicada. Três buracos medidos nesta data:
 *
 *   1. `https://divulgacandcontas.tse.jus.br/divulga/` responde 200 e entrega
 *      46 caracteres de texto. É a casca do SPA do TSE. Passava no regex de
 *      caminho e no gate de gravidade, e sustentava uma claim de gravidade
 *      alta sobre o patrimônio de uma pessoa nomeada.
 *   2. `https://noticias.stf.jus.br/...` responde 200 com o texto completo na
 *      primeira requisição e 202 com corpo VAZIO nas seguintes. É limitador de
 *      taxa, não página morta. Um link-check ingênuo leria o 202 como 2xx e
 *      diria "viva"; um link-check paranoico leria corpo vazio e diria "morta".
 *      As duas leituras estão erradas.
 *   3. Vedação eleitoral. Em 2026-07-25, `agenciaminas.mg.gov.br` responde 503
 *      com "Em cumprimento à legislação eleitoral, este site encontra-se com as
 *      funcionalidades desativadas", e páginas de notícia de `goias.gov.br`
 *      respondem 200 com o mesmo aviso no lugar da matéria. São fontes
 *      legítimas fora do ar por lei, com data para voltar. Despublicar claim
 *      por causa disso seria trocar um erro por outro.
 *
 * Daí os três vereditos: `com_conteudo`, `sem_substancia` e `indisponivel`.
 * Nenhum deles é "morta": morte de URL continua sendo decidida pelo status
 * (404, 410, DNS inexistente) em scripts/link-check-pontos-atencao.ts.
 *
 * Todas as funções aqui são puras e sem rede, para poderem ser testadas com
 * corpo fixo em tests/fonte-substancia.test.ts.
 */

/** Veredito de substância de um corpo de resposta já baixado. */
export type SubstanciaVeredito = "com_conteudo" | "sem_substancia" | "indisponivel"

export interface SubstanciaAnalise {
  veredito: SubstanciaVeredito
  motivo: string
  caracteresUteis: number
}

export interface SubstanciaEntrada {
  httpStatus: number
  contentType: string | null
  corpo: string
  bytes: number
}

/**
 * Piso de texto útil para uma página HTML sustentar qualquer afirmação.
 *
 * Calibração medida em 2026-07-25 (caracteres de texto depois de remover
 * script, style, comentário e tags):
 *   46    casca do SPA do DivulgaCandContas
 *   217   `tse.jus.br/eleicoes/estatisticas/estatisticas-eleitorais` atrás do
 *         desafio anti-robô do F5
 *   227   `ba.gov.br` (aviso de navegador)
 *   614   página de bloqueio da Agência Minas
 *   2385  matéria do STF sobre a denúncia contra Sérgio Moro
 *   3599  matéria da Agência Brasil sobre a eleição de 2018 no RJ
 *   4651  matéria do Senado sobre a mesma eleição
 *   8175  matéria no portal antigo do STF
 *
 * 500 separa casca de matéria com folga dos dois lados. Páginas de bloqueio
 * mais falantes (a da Agência Minas passa de 500) são pegas pelos marcadores,
 * não pelo tamanho.
 */
export const TEXTO_MINIMO_UTIL = 500

/** Piso para corpo binário (PDF, ZIP, JSON de API). Abaixo disso é truncagem. */
export const BYTES_MINIMO_BINARIO = 1024

/**
 * Teto de tamanho para os marcadores anti-robô valerem.
 *
 * Página de desafio é curta por natureza (a do F5 no TSE tem 217 caracteres).
 * Matéria jurídica longa pode citar "acesso negado" ou "captcha" no corpo do
 * texto sem ser um bloqueio. Sem este teto, a checagem transformaria fonte boa
 * em alerta falso.
 */
export const LIMITE_PAGINA_DE_DESAFIO = 3000

/**
 * Domínios que só respondem conteúdo de forma intermitente e que, por isso,
 * NUNCA podem ser despublicados por decisão automática.
 *
 * `noticias.stf.jus.br`: medido em 2026-07-25. A primeira requisição depois de
 * um intervalo de folga devolve 200 com a matéria inteira; requisições
 * seguintes na mesma janela devolvem 202 com corpo vazio, mesmo espaçadas em
 * 20 segundos. O conteúdo existe e é oficial. O que falha é o robô, não a
 * fonte. Rota alternativa quando o valor literal é necessário: o portal antigo
 * (`portal.stf.jus.br/noticias/verNoticiaDetalhe.asp?idConteudo=N`) serve parte
 * do acervo, mas nem todo `idConteudo` traz o corpo da matéria, então ele não
 * substitui a verificação humana.
 */
export const DOMINIOS_VERIFICACAO_MANUAL = ["noticias.stf.jus.br"] as const

/** Marcadores de página desativada por legislação eleitoral. */
const MARCADORES_VEDACAO: RegExp[] = [
  /cumprimento (a|as) legislacao eleitoral/,
  /respeito (a|as) legislacao eleitoral/,
  /periodo de vedacao/,
  /(legislacao|periodo) eleitoral[^.]{0,120}(desativad|indisponivel|suspens|restabelec)/,
  /(desativad|indisponivel|suspens)[^.]{0,120}(legislacao|periodo) eleitoral/,
]

/** Marcadores de desafio anti-robô (WAF, captcha, verificação de navegador). */
const MARCADORES_ANTI_ROBO: RegExp[] = [
  /visitante humano/,
  /support id:/,
  /captcha/,
  /just a moment/,
  /attention required/,
  /(verificando seu navegador|checking your browser)/,
  /(acesso negado|access denied|forbidden)/,
]

/** Content-types cujo corpo não é HTML e não deve passar por strip de tags. */
const TIPOS_NAO_HTML =
  /^(application\/(pdf|zip|json|.*\+json|octet-stream|vnd\.|msword)|image\/|audio\/|video\/|text\/csv)/i

/** Remove acento e caixa para o texto casar com os marcadores. */
function normalizarParaMarcador(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/**
 * Texto que um leitor humano veria. Remove script, style, noscript, comentário
 * e tags, e colapsa espaço. Deliberadamente simples: o objetivo é medir ordem
 * de grandeza, não renderizar a página.
 */
export function extrairTextoUtil(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function pareceVedacaoEleitoral(texto: string): boolean {
  const alvo = normalizarParaMarcador(texto)
  return MARCADORES_VEDACAO.some((re) => re.test(alvo))
}

export function pareceDesafioAntiRobo(texto: string): boolean {
  const alvo = normalizarParaMarcador(texto)
  return MARCADORES_ANTI_ROBO.some((re) => re.test(alvo))
}

export function ehTipoNaoHtml(contentType: string | null): boolean {
  return typeof contentType === "string" && TIPOS_NAO_HTML.test(contentType.trim())
}

export function dominioExigeVerificacaoManual(url: unknown): boolean {
  if (typeof url !== "string") return false
  let host: string
  try {
    host = new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return false
  }
  return DOMINIOS_VERIFICACAO_MANUAL.some((d) => host === d || host.endsWith(`.${d}`))
}

/**
 * Decide se o corpo baixado sustenta alguma coisa.
 *
 * A ordem das checagens é a ordem de força da evidência: bloqueio declarado
 * vence tamanho, e tamanho vence otimismo. Nunca devolve "morta": esta função
 * não opina sobre existência do recurso, só sobre o que veio no corpo.
 */
export function analisarSubstancia(entrada: SubstanciaEntrada): SubstanciaAnalise {
  const { httpStatus, contentType, corpo, bytes } = entrada

  if (bytes === 0) {
    return {
      veredito: "indisponivel",
      motivo: `HTTP ${httpStatus} com corpo vazio, tipico de limitador de taxa ou WAF`,
      caracteresUteis: 0,
    }
  }

  if (ehTipoNaoHtml(contentType)) {
    if (bytes < BYTES_MINIMO_BINARIO) {
      return {
        veredito: "sem_substancia",
        motivo: `corpo de ${bytes} bytes em ${contentType}, abaixo do minimo de ${BYTES_MINIMO_BINARIO}`,
        caracteresUteis: bytes,
      }
    }
    return {
      veredito: "com_conteudo",
      motivo: `${bytes} bytes de ${contentType}`,
      caracteresUteis: bytes,
    }
  }

  const texto = extrairTextoUtil(corpo)

  if (pareceVedacaoEleitoral(texto)) {
    return {
      veredito: "indisponivel",
      motivo: "pagina desativada por legislacao eleitoral, volta ao fim do periodo de vedacao",
      caracteresUteis: texto.length,
    }
  }

  if (texto.length < LIMITE_PAGINA_DE_DESAFIO && pareceDesafioAntiRobo(texto)) {
    return {
      veredito: "indisponivel",
      motivo: "desafio anti-robo no lugar do conteudo (WAF, captcha ou verificacao de navegador)",
      caracteresUteis: texto.length,
    }
  }

  if (texto.length < TEXTO_MINIMO_UTIL) {
    return {
      veredito: "sem_substancia",
      motivo: `apenas ${texto.length} caracteres de texto util, minimo ${TEXTO_MINIMO_UTIL}`,
      caracteresUteis: texto.length,
    }
  }

  return {
    veredito: "com_conteudo",
    motivo: `${texto.length} caracteres de texto util`,
    caracteresUteis: texto.length,
  }
}
