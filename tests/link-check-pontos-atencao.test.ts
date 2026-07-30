/**
 * Regras de decisão do link-check de fontes (scripts/link-check-pontos-atencao.ts).
 *
 * O que estes testes protegem: a única escrita que o script faz é despublicar
 * uma claim. Se a classificação errar para o lado permissivo, o site volta a
 * publicar afirmação grave com fonte morta (achado V1 da auditoria de
 * 2026-07-24). Se errar para o lado agressivo, tira do ar claim boa porque um
 * servidor bloqueou robô ou porque a fonte oficial está suspensa por vedação
 * eleitoral. Os dois lados estão cobertos aqui.
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  classificarHttp,
  erroDeRedeEhMorte,
  hostDaUrl,
  mapPorHost,
  runLinkCheck,
  type LinkCheckDeps,
  type PontoAtencaoLinkRow,
  type UrlProbe,
} from "../scripts/link-check-pontos-atencao"

function ponto(over: Partial<PontoAtencaoLinkRow> & { id: string }): PontoAtencaoLinkRow {
  return {
    candidato_id: "cand-1",
    titulo: "claim",
    gravidade: "critica",
    visivel: true,
    fontes: [],
    dados_relacionados: null,
    ...over,
  }
}

function deps(
  rows: PontoAtencaoLinkRow[],
  probes: Record<string, UrlProbe["status"]>,
  over: Partial<LinkCheckDeps> = {},
): LinkCheckDeps & { despublicados: string[]; avisos: string[] } {
  const despublicados: string[] = []
  const avisos: string[] = []
  return {
    apply: false,
    onlyVisible: false,
    limit: null,
    fetchRows: async () => rows,
    probeUrls: async (urls) =>
      urls.map((url) => ({
        url,
        status: probes[url] ?? "indisponivel",
        httpStatus: null,
        detalhe: "teste",
      })),
    despublicar: async (row) => {
      despublicados.push(row.id)
    },
    log: () => {},
    warn: (m) => {
      avisos.push(m)
    },
    error: () => {},
    agora: () => new Date("2026-07-25T12:00:00Z"),
    despublicados,
    avisos,
    ...over,
  }
}

describe("classificarHttp", () => {
  it("2xx e 3xx passam pelo filtro de status", () => {
    assert.equal(classificarHttp(200), "viva")
    assert.equal(classificarHttp(204), "viva")
    assert.equal(classificarHttp(301), "viva")
  })

  it("só 404 e 410 são mortas", () => {
    assert.equal(classificarHttp(404), "morta")
    assert.equal(classificarHttp(410), "morta")
  })

  it("bloqueio e instabilidade são indisponíveis, nunca mortos", () => {
    for (const status of [401, 403, 405, 429, 500, 502, 503]) {
      assert.equal(classificarHttp(status), "indisponivel", `status ${status}`)
    }
  })
})

describe("erroDeRedeEhMorte", () => {
  it("só DNS inexistente conta como morte", () => {
    assert.equal(erroDeRedeEhMorte("getaddrinfo ENOTFOUND dominio-que-nao-existe.com"), true)
    assert.equal(erroDeRedeEhMorte("fetch failed"), false)
    assert.equal(erroDeRedeEhMorte("The operation was aborted"), false)
    assert.equal(erroDeRedeEhMorte("ECONNRESET"), false)
  })
})

describe("hostDaUrl", () => {
  it("normaliza para minúscula e devolve a string crua quando não é URL", () => {
    assert.equal(hostDaUrl("https://Noticias.STF.jus.br/a/b"), "noticias.stf.jus.br")
    assert.equal(hostDaUrl("nao e url"), "nao e url")
  })
})

describe("mapPorHost", () => {
  it("preserva a ordem de entrada mesmo agrupando por host", async () => {
    const urls = [
      "https://a.com/1",
      "https://b.com/1",
      "https://a.com/2",
      "https://c.com/1",
      "https://b.com/2",
    ]
    const out = await mapPorHost(urls, 4, 0, async (url) => url.toUpperCase())
    assert.deepEqual(out, urls.map((u) => u.toUpperCase()))
  })

  it("nunca dispara duas requisições simultâneas ao mesmo host", async () => {
    // É esta serialização que evita o 202 com corpo vazio que
    // noticias.stf.jus.br devolve sob rajada, ou seja, evita que o próprio
    // robô fabrique o falso negativo que depois despublicaria claim boa.
    const emVoo = new Map<string, number>()
    let pico = 0
    await mapPorHost(
      ["https://a.com/1", "https://a.com/2", "https://a.com/3", "https://b.com/1"],
      4,
      0,
      async (url) => {
        const host = hostDaUrl(url)
        const atual = (emVoo.get(host) ?? 0) + 1
        emVoo.set(host, atual)
        pico = Math.max(pico, atual)
        await new Promise((r) => setTimeout(r, 5))
        emVoo.set(host, atual - 1)
        return url
      },
    )
    assert.equal(pico, 1)
  })
})

describe("runLinkCheck", () => {
  const url404 = "https://g1.globo.com/politica/mensalao/noticia/2012/12/stf.ghtml"
  const url200 = "https://portal.stf.jus.br/processos/detalhe.asp?incidente=1"

  it("dry-run não escreve nada mesmo com todas as fontes mortas", async () => {
    const d = deps([ponto({ id: "a", fontes: [{ url: url404 }] })], { [url404]: "morta" })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsTotalmenteMortas.length, 1)
    assert.equal(r.despublicadas, 0)
    assert.deepEqual(d.despublicados, [])
  })

  it("apply despublica a claim cujas fontes estão todas mortas", async () => {
    const d = deps([ponto({ id: "a", fontes: [{ url: url404 }] })], { [url404]: "morta" }, { apply: true })
    const r = await runLinkCheck(d)

    assert.equal(r.despublicadas, 1)
    assert.deepEqual(d.despublicados, ["a"])
  })

  it("não despublica quando ainda existe fonte viva", async () => {
    const d = deps(
      [ponto({ id: "a", fontes: [{ url: url404 }, { url: url200 }] })],
      { [url404]: "morta", [url200]: "viva" },
      { apply: true },
    )
    const r = await runLinkCheck(d)

    assert.equal(r.claimsTotalmenteMortas.length, 0)
    assert.equal(r.claimsParcialmenteMortas.length, 1)
    assert.deepEqual(d.despublicados, [])
  })

  it("não despublica quando a outra fonte apenas bloqueou o robô", async () => {
    const bloqueada = "https://www1.folha.uol.com.br/poder/materia.shtml"
    const d = deps(
      [ponto({ id: "a", fontes: [{ url: url404 }, { url: bloqueada }] })],
      { [url404]: "morta", [bloqueada]: "indisponivel" },
      { apply: true },
    )
    const r = await runLinkCheck(d)

    assert.equal(r.claimsTotalmenteMortas.length, 0)
    assert.deepEqual(d.despublicados, [])
  })

  it("não despublica quando a outra fonte está sob vedação eleitoral", async () => {
    // agenciaminas.mg.gov.br em 2026-07-25: HTTP 503 com aviso de legislação
    // eleitoral. Fonte legítima que volta sozinha ao fim da vedação.
    const vedada = "https://agenciaminas.mg.gov.br/noticia/acordo-homologado"
    const d = deps(
      [ponto({ id: "a", fontes: [{ url: url404 }, { url: vedada }] })],
      { [url404]: "morta", [vedada]: "indisponivel" },
      { apply: true },
    )
    const r = await runLinkCheck(d)

    assert.equal(r.despublicadas, 0)
    assert.equal(r.urlsIndisponiveis, 1)
  })

  it("não despublica quando a fonte morta é de domínio que exige verificação humana", async () => {
    // noticias.stf.jus.br responde 200 na primeira requisição e 202 vazio nas
    // seguintes. Nenhum veredito automático pode tirar claim do ar por ele.
    const stf = "https://noticias.stf.jus.br/postsnoticias/stf-recebe-denuncia-contra-sergio-moro-pelo-crime-de-calunia/"
    const d = deps([ponto({ id: "a", fontes: [{ url: stf }] })], { [stf]: "morta" }, { apply: true })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsTotalmenteMortas.length, 1)
    assert.equal(r.despublicadas, 0)
    assert.equal(r.bloqueadasPorVerificacaoManual, 1)
    assert.deepEqual(d.despublicados, [])
    assert.ok(d.avisos.some((m) => m.includes("verificacao humana")))
  })

  it("claim já fora do ar não é reescrita", async () => {
    const d = deps(
      [ponto({ id: "a", visivel: false, fontes: [{ url: url404 }] })],
      { [url404]: "morta" },
      { apply: true },
    )
    const r = await runLinkCheck(d)

    assert.equal(r.claimsTotalmenteMortas.length, 1)
    assert.equal(r.despublicadas, 0)
    assert.deepEqual(d.despublicados, [])
  })

  it("claim sem nenhuma fonte não entra no veredito do link-check", async () => {
    const d = deps([ponto({ id: "a", fontes: [] })], {}, { apply: true })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsTotalmenteMortas.length, 0)
    assert.equal(r.claimsSemFonteComConteudo.length, 0)
    assert.deepEqual(d.despublicados, [])
  })

  it("erro de escrita é contado e não derruba a execução", async () => {
    const d = deps([ponto({ id: "a", fontes: [{ url: url404 }] })], { [url404]: "morta" }, {
      apply: true,
      despublicar: async () => {
        throw new Error("permission denied")
      },
    })
    const r = await runLinkCheck(d)

    assert.equal(r.erros, 1)
    assert.equal(r.despublicadas, 0)
  })

  it("URL de domínio nu é reportada como sem caminho, não como morta", async () => {
    const nu = "https://g1.globo.com/"
    const d = deps([ponto({ id: "a", fontes: [{ url: nu }] })], { [nu]: "sem_caminho" }, { apply: true })
    const r = await runLinkCheck(d)

    assert.equal(r.urlsSemCaminho, 1)
    assert.equal(r.urlsMortas, 0)
    assert.deepEqual(d.despublicados, [])
  })

  it("fonte que responde 200 sem substância vira alerta, nunca despublicação", async () => {
    // O caso do ronaldo-caiado: única fonte devolvia a casca do SPA do TSE.
    const spa = "https://divulgacandcontas.tse.jus.br/divulga/inicio"
    const d = deps([ponto({ id: "a", gravidade: "alta", fontes: [{ url: spa }] })], { [spa]: "sem_substancia" }, {
      apply: true,
    })
    const r = await runLinkCheck(d)

    assert.equal(r.urlsSemSubstancia, 1)
    assert.equal(r.claimsSemFonteComConteudo.length, 1)
    assert.equal(r.claimsTotalmenteMortas.length, 0)
    assert.equal(r.despublicadas, 0)
    assert.ok(d.avisos.some((m) => m.includes("sem nenhuma fonte com conteudo")))
  })

  it("claim invisível sem fonte com conteúdo não vira alerta", async () => {
    const spa = "https://divulgacandcontas.tse.jus.br/divulga/inicio"
    const d = deps([ponto({ id: "a", visivel: false, fontes: [{ url: spa }] })], { [spa]: "sem_substancia" })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsSemFonteComConteudo.length, 0)
  })

  it("claim com uma fonte viva e outra sem substância não vira alerta", async () => {
    const spa = "https://divulgacandcontas.tse.jus.br/divulga/inicio"
    const d = deps([ponto({ id: "a", fontes: [{ url: spa }, { url: url200 }] })], {
      [spa]: "sem_substancia",
      [url200]: "viva",
    })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsSemFonteComConteudo.length, 0)
  })

  it("só claims visíveis são analisadas quando onlyVisible está ligado", async () => {
    const d = deps(
      [ponto({ id: "a", fontes: [{ url: url404 }] }), ponto({ id: "b", visivel: false, fontes: [{ url: url200 }] })],
      { [url404]: "morta", [url200]: "viva" },
      { onlyVisible: true },
    )
    const r = await runLinkCheck(d)

    assert.equal(r.claims, 1)
    assert.equal(r.urlsUnicas, 1)
  })
})

/**
 * Dois níveis de alarme (2026-07-29).
 *
 * O que estes testes protegem: a primeira execução real reprovou 71 claims,
 * das quais só 7 estavam em ficha pública, e essas 7 tinham todas as fontes
 * apenas `indisponivel`. Sem a separação, o job semanal nasce vermelho por
 * ruído e alguém silencia justamente a rede que deveria pegar o problema real.
 * O lado oposto também está coberto: nada aqui pode fazer defeito real de
 * fonte em ficha pública deixar de ser defeito.
 */
describe("runLinkCheck: recorte público e defeito real de fonte", () => {
  const url404 = "https://g1.globo.com/politica/mensalao/noticia/2012/12/stf.ghtml"
  const url200 = "https://portal.stf.jus.br/processos/detalhe.asp?incidente=1"

  it("fonte só indisponível não conta como defeito real: é temporária e volta sozinha", async () => {
    const d = deps([ponto({ id: "a", fontes: [{ url: url200 }] })], { [url200]: "indisponivel" })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsSemFonteComConteudo.length, 1, "segue reportada como sem conteúdo")
    assert.equal(r.claimsSemFonteUtilizavel.length, 0, "mas não é defeito que derrube o gate")
  })

  it("fonte morta, sem caminho ou sem substância conta como defeito real", async () => {
    for (const status of ["morta", "sem_caminho", "sem_substancia"] as const) {
      const d = deps([ponto({ id: "a", fontes: [{ url: url200 }] })], { [url200]: status })
      const r = await runLinkCheck(d)

      assert.equal(r.claimsSemFonteUtilizavel.length, 1, `${status} deve ser defeito real`)
    }
  })

  it("uma fonte viva junto de uma indisponível não gera alarme algum", async () => {
    const d = deps([ponto({ id: "a", fontes: [{ url: url200 }, { url: url404 }] })], {
      [url200]: "viva",
      [url404]: "indisponivel",
    })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsSemFonteComConteudo.length, 0)
    assert.equal(r.claimsSemFonteUtilizavel.length, 0)
  })

  it("claim de candidato fora do front é marcada como não pública e fica separável", async () => {
    const d = deps(
      [
        ponto({ id: "publica", fontes: [{ url: url404 }] }),
        ponto({ id: "fila", publico: false, fontes: [{ url: url404 }] }),
      ],
      { [url404]: "morta" },
    )
    const r = await runLinkCheck(d)

    assert.equal(r.claimsSemFonteUtilizavel.length, 2, "as duas seguem sendo defeito real")
    assert.deepEqual(
      r.claimsSemFonteUtilizavel.filter((v) => v.publico).map((v) => v.id),
      ["publica"],
      "só a de candidato publicado entra no recorte que derruba o gate",
    )
    assert.deepEqual(
      r.claimsComFonteMorta.filter((v) => !v.publico).map((v) => v.id),
      ["fila"],
      "a outra continua visível no relatório como fila de publicação",
    )
  })

  it("linha sem o campo publico é tratada como pública: na dúvida o alarme fala mais alto", async () => {
    const d = deps([ponto({ id: "a", fontes: [{ url: url404 }] })], { [url404]: "morta" })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsComFonteMorta[0]?.publico, true)
  })

  it("claim invisível com fonte morta não entra em claimsComFonteMorta", async () => {
    const d = deps([ponto({ id: "a", visivel: false, fontes: [{ url: url404 }] })], { [url404]: "morta" })
    const r = await runLinkCheck(d)

    assert.equal(r.claimsComFonteMorta.length, 0, "já está fora do ar, não há o que alarmar")
  })
})
