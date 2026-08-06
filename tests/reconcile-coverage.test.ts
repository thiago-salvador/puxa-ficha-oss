import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  classificarConsulta,
  normalizarSnapshot,
  parseArgs,
  parsearCelulasHtml,
  reconciliarCobertura,
  type CandidatoSnapshot,
  type OpcoesReconciliacao
} from "../scripts/audit/reconcile-coverage"

describe("parsearCelulasHtml", () => {
  it("lê estado e proveniência e ignora a coluna de índice", () => {
    const html = `<table><tbody><tr>
      <td class="scr s-hi" data-slug="ana" data-col="indice">80%</td>
      <td title="fonte &amp; escopo" data-col="processos" class="c-zero" data-prov="curadoria_concluida_sem_achado" data-slug="ana">0</td>
      <td data-slug="ana" class="c-na" data-col="gastos">—</td>
    </tr></tbody></table>`
    assert.deepEqual(parsearCelulasHtml(html), [
      {
        slug: "ana",
        coluna: "gastos",
        estado: "na",
        proveniencia: null,
        texto: "—",
        detalhe: null
      },
      {
        slug: "ana",
        coluna: "processos",
        estado: "zero",
        proveniencia: "curadoria_concluida_sem_achado",
        texto: "0",
        detalhe: "fonte & escopo"
      }
    ])
  })

  it("rejeita células duplicadas", () => {
    const td = `<td class="c-zero" data-slug="ana" data-col="x">0</td>`
    assert.throws(() => parsearCelulasHtml(td + td), /célula duplicada/)
  })
})

describe("classificarConsulta", () => {
  it("só classifica quando o resultado ou detalhe provam a categoria", () => {
    assert.equal(classificarConsulta("nao_aplicavel", null).classificacao, "N/A")
    assert.equal(
      classificarConsulta("sem_achado_no_escopo", "busca limitada").classificacao,
      "busca esgotada no escopo"
    )
    assert.equal(
      classificarConsulta("erro", "fonte indisponível, HTTP 503").classificacao,
      "fonte indisponível"
    )
    assert.equal(
      classificarConsulta("indeterminado", "homônimo sem segundo identificador").classificacao,
      "identidade sem prova"
    )
    assert.equal(
      classificarConsulta("indeterminado", "curadoria em andamento").classificacao,
      "curadoria em andamento"
    )
    assert.equal(
      classificarConsulta("erro", "TypeError no script").classificacao,
      "erro de código ainda aberto"
    )
    assert.equal(
      classificarConsulta("erro", "falhou por razão não descrita").classificacao,
      "curadoria em andamento"
    )
  })
})

describe("normalizarSnapshot e parseArgs", () => {
  it("aceita array direto e wrappers da Management API", () => {
    const candidato = { slug: "ana" }
    assert.deepEqual(normalizarSnapshot([candidato]), [candidato])
    assert.deepEqual(normalizarSnapshot({ snapshot: [candidato] }), [candidato])
    assert.deepEqual(normalizarSnapshot([{ snapshot: [candidato] }]), [candidato])
  })

  it("aceita flags com igual e com argumento separado", () => {
    const opcoes = parseArgs([
      "--before-html=a.html",
      "--before-snapshot",
      "b.json",
      "--after-html=c.html",
      "--after-snapshot=d.json",
      "--out=e.json"
    ])
    assert.match(opcoes.beforeHtml, /a\.html$/)
    assert.match(opcoes.beforeSnapshot, /b\.json$/)
    assert.match(opcoes.out, /e\.json$/)
  })
})

function htmlCompleto(after: boolean): string {
  const colunas = Array.from({ length: 23 }, (_, indice) => `c${String(indice).padStart(2, "0")}`)
  const linhas: string[] = []
  for (let candidato = 0; candidato < 194; candidato++) {
    const slug = `cand-${String(candidato).padStart(3, "0")}`
    for (const [indice, coluna] of colunas.entries()) {
      if (indice === 0) {
        const prov = after ? "curadoria_concluida_sem_achado" : "nunca_verificado"
        linhas.push(`<td class="c-zero" data-slug="${slug}" data-col="${coluna}" data-prov="${prov}">0</td>`)
      } else if (indice === 1) {
        linhas.push(`<td class="c-${after ? "ok" : "missing"}" data-slug="${slug}" data-col="${coluna}">${after ? 1 : 0}</td>`)
      } else {
        linhas.push(`<td class="c-ok" data-slug="${slug}" data-col="${coluna}">1</td>`)
      }
    }
  }
  return `<table>${linhas.join("")}</table>`
}

function snapshotCompleto(after: boolean): CandidatoSnapshot[] {
  return Array.from({ length: 194 }, (_, candidato) => ({
    slug: `cand-${String(candidato).padStart(3, "0")}`,
    coleta: {
      "processos-curadoria": after
        ? {
            resultado: "sem_achado_no_escopo",
            detalhe: "busca concluída no escopo declarado"
          }
        : { resultado: "indeterminado", detalhe: "curadoria em andamento" }
    },
    itensRevisar: candidato === 0 && after ? [{ id: "r1", titulo: "Revisar fato" }] : []
  }))
}

describe("reconciliarCobertura", () => {
  it("valida 194 candidatos/4462 células e não chama renome de redução", () => {
    const inputs: OpcoesReconciliacao = {
      beforeHtml: "/before.html",
      beforeSnapshot: "/before.json",
      afterHtml: "/after.html",
      afterSnapshot: "/after.json",
      out: "/evidence.json"
    }
    const evidencia = reconciliarCobertura(
      htmlCompleto(false),
      snapshotCompleto(false),
      htmlCompleto(true),
      snapshotCompleto(true),
      inputs,
      "2026-08-06T00:00:00.000Z"
    )

    assert.deepEqual(evidencia.metadata.observado.after, { candidatos: 194, celulas: 4462 })
    assert.equal(evidencia.totais.reducoes_legitimas.celulas, 194)
    assert.equal(evidencia.totais.mudancas_apenas_de_categoria.celulas, 194)
    assert.equal(evidencia.totais.mudancas_apenas_de_categoria.consultas_fonte_candidato, 194)
    assert.equal(evidencia.totais.reducoes_legitimas.consultas_fonte_candidato, 0)
    assert.equal(
      evidencia.breakdown.por_consulta_fonte_candidato.find(
        (item) => item.slug === "cand-000" && item.fonte === "processos-curadoria"
      )?.classificacao,
      "busca esgotada no escopo"
    )
    assert.ok(
      evidencia.residuos.some(
        (item) => item.tipo === "item_aprovacao" && item.classificacao === "aguardando aprovação"
      )
    )
  })

  it("falha fechado quando a cardinalidade não é a esperada", () => {
    const inputs = {} as OpcoesReconciliacao
    assert.throws(
      () => reconciliarCobertura("", [], "", [], inputs),
      /esperado 194 candidatos/
    )
  })
})
