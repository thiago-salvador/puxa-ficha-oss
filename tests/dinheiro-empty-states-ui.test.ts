import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MoneyTabSection } from "@/components/CandidatoProfileSections"
import type { Financiamento, Patrimonio } from "@/lib/types"

function patrimonioRow(partial: Partial<Patrimonio> & Pick<Patrimonio, "id">): Patrimonio {
  return {
    candidato_id: "candidato-teste",
    ano_eleicao: 2022,
    valor_total: 150_000,
    bens: [
      {
        tipo: "Imóvel",
        descricao: "Apartamento residencial",
        valor: 150_000,
      },
    ],
    ...partial,
    id: partial.id,
  }
}

function financiamentoRow(
  partial: Partial<Financiamento> & Pick<Financiamento, "id">
): Financiamento {
  return {
    candidato_id: "candidato-teste",
    ano_eleicao: 2022,
    total_arrecadado: 50_000,
    total_fundo_partidario: 10_000,
    total_fundo_eleitoral: 20_000,
    total_pessoa_fisica: 15_000,
    total_recursos_proprios: 5_000,
    maiores_doadores: [],
    ...partial,
    id: partial.id,
  }
}

function renderMoneyTab(args: {
  patrimonio: Patrimonio[]
  financiamento: Financiamento[]
  historicoLength: number
}) {
  return renderToStaticMarkup(
    createElement(MoneyTabSection, {
      patrimonio: args.patrimonio,
      financiamento: args.financiamento,
      historico: [],
      gastos: [],
      historicoLength: args.historicoLength,
      suggestion: null,
    })
  )
}

test("MoneyTabSection mostra empty state combinado e notable quando candidato tem histórico político e nenhum dado financeiro", () => {
  const html = renderMoneyTab({
    patrimonio: [],
    financiamento: [],
    historicoLength: 3,
  })

  assert.ok(html.includes("Dinheiro"), "deve exibir o section label Dinheiro")
  assert.ok(html.includes("Dados financeiros"), "deve exibir o section title Dados financeiros")
  assert.ok(
    html.includes("Nenhum patrimônio declarado no TSE"),
    "deve exibir o título notable de patrimônio quando há histórico"
  )
  assert.ok(
    html.includes(
      "Para um candidato com histórico de cargos públicos, a ausência de declaração de bens é uma informação relevante."
    ),
    "deve exibir a descrição notable completa"
  )
  assert.ok(html.includes("Dado relevante"), "deve exibir o eyebrow Dado relevante (sinalização notable)")
  assert.ok(
    html.includes('data-pf-notice-tone="caution"'),
    "o NoticePanel interno deve renderizar com tone caution quando notable"
  )
  assert.ok(
    !html.includes("Sem declaração de patrimônio"),
    "não deve misturar o título neutral quando o candidato tem histórico"
  )
  assert.ok(
    !html.includes("Sem dados de financiamento"),
    "não deve exibir o empty state separado de financiamento quando ambos estão vazios"
  )
})

test("MoneyTabSection mostra empty state combinado e neutral quando candidato não tem histórico e nenhum dado financeiro", () => {
  const html = renderMoneyTab({
    patrimonio: [],
    financiamento: [],
    historicoLength: 0,
  })

  assert.ok(html.includes("Dinheiro"))
  assert.ok(html.includes("Dados financeiros"))
  assert.ok(
    html.includes("Sem declaração de patrimônio"),
    "deve exibir o título neutral quando não há histórico"
  )
  assert.ok(
    html.includes("Este candidato não possui declarações de bens registradas no TSE."),
    "deve exibir a descrição neutral completa"
  )
  assert.ok(
    !html.includes("Dado relevante"),
    "não deve exibir o eyebrow notable quando o empty state é neutral"
  )
  assert.ok(
    html.includes('data-pf-notice-tone="neutral"'),
    "o NoticePanel interno deve renderizar com tone neutral"
  )
  assert.ok(
    !html.includes("Nenhum patrimônio declarado no TSE"),
    "não deve exibir o título notable quando não há histórico"
  )
})

test("MoneyTabSection mostra empty state só de patrimônio quando há financiamento mas não há bens declarados", () => {
  const html = renderMoneyTab({
    patrimonio: [],
    financiamento: [financiamentoRow({ id: "fin-2022" })],
    historicoLength: 0,
  })

  assert.ok(
    html.includes("Sem declaração de patrimônio"),
    "deve exibir o empty state de patrimônio neutral"
  )
  assert.ok(
    html.includes("Este candidato não possui declarações de bens registradas no TSE."),
    "deve incluir a descrição de patrimônio ausente"
  )
  assert.ok(
    !html.includes("Sem dados de financiamento"),
    "não deve exibir o empty state de financiamento quando há linha válida"
  )
  assert.ok(
    !html.includes("Dados financeiros"),
    "não deve cair no empty state combinado quando há financiamento"
  )
  assert.ok(
    html.includes("De onde vem o dinheiro"),
    "deve renderizar a seção real de financiamento"
  )
})

test("MoneyTabSection mostra empty state só de financiamento quando há patrimônio mas não há receitas", () => {
  const html = renderMoneyTab({
    patrimonio: [patrimonioRow({ id: "patr-2022" })],
    financiamento: [],
    historicoLength: 0,
  })

  assert.ok(
    html.includes("Sem dados de financiamento"),
    "deve exibir o empty state de financiamento"
  )
  assert.ok(
    html.includes(
      "Não há registros de financiamento de campanha para este candidato no TSE."
    ),
    "deve incluir a descrição de financiamento ausente"
  )
  assert.ok(
    !html.includes("Sem declaração de patrimônio"),
    "não deve exibir o empty state de patrimônio neutral quando há linha de patrimônio"
  )
  assert.ok(
    !html.includes("Nenhum patrimônio declarado no TSE"),
    "não deve exibir o empty state de patrimônio notable quando há linha de patrimônio"
  )
  assert.ok(
    !html.includes("Dados financeiros"),
    "não deve cair no empty state combinado quando há patrimônio"
  )
  assert.ok(
    html.includes("Patrimônio declarado"),
    "deve renderizar a seção real de patrimônio"
  )
})
