import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { processosOverviewDisplay } from "../src/lib/processos-display"
import { getProcessosEmptyState } from "../src/components/EmptyState"

describe("processosOverviewDisplay", () => {
  it("zero nunca vira '0': é ausência de verificação, não contagem", () => {
    assert.deepEqual(processosOverviewDisplay(0), { value: "—", sub: "não verificado" })
    assert.deepEqual(processosOverviewDisplay(null), { value: "—", sub: "não verificado" })
    assert.deepEqual(processosOverviewDisplay(undefined), { value: "—", sub: "não verificado" })
  })

  it("contagem positiva continua numérica, com destaque criminal", () => {
    assert.deepEqual(processosOverviewDisplay(3, 1), { value: 3, sub: "1 criminal" })
    assert.deepEqual(processosOverviewDisplay(2, 0), { value: 2, sub: undefined })
  })
})

describe("getProcessosEmptyState", () => {
  it("não afirma consulta que não houve, e nega a inferência de ficha limpa", () => {
    const estado = getProcessosEmptyState()
    const texto = `${estado.title} ${estado.description}`
    assert.ok(!texto.includes("bases consultadas"), "copy antiga afirmava consulta inexistente")
    assert.ok(!texto.toLowerCase().includes("nenhum processo encontrado"))
    assert.ok(texto.includes("não significa ficha limpa"))
    assert.ok(texto.includes("busca ativa"))
  })
})

describe("ComparadorPanel: a mesma régua do overview vale no comparador", () => {
  const fonte = readFileSync("src/components/ComparadorPanel.tsx", "utf-8")

  it("nenhuma superfície visível renderiza total_processos cru", () => {
    // As duas células que exibiam o número entravam em contradição com a
    // ficha: "0 processos" afirma busca ativa que não houve. O único
    // `{candidato.total_processos}` que pode sobrar é o data-attribute, que
    // por contrato carrega o valor cru.
    // O lookbehind deixa passar `${...}`: as interpolações que sobraram estão
    // dentro do ramo guardado por `total_processos > 0`, onde o número é real.
    const semDataAttr = fonte.replace(/data-pf-comparador-processos=\{candidato\.total_processos\}/g, "")
    assert.doesNotMatch(semDataAttr, /(?<!\$)\{candidato\.total_processos\}/)
    assert.match(fonte, /processosOverviewDisplay\(candidato\.total_processos\)/)
  })

  it("a lista compacta e o aria-label dizem não verificado em vez de zero", () => {
    // Leitor de tela precisa ouvir o mesmo que a tela mostra.
    const ocorrencias = fonte.match(/processos não verificados/g) ?? []
    assert.equal(ocorrencias.length, 2, "esperado no aria-label e na lista compacta")
    assert.doesNotMatch(fonte, /\$\{candidato\.total_processos\} processos, /)
  })

  it("o atributo de dado e o destaque 'maior' continuam no valor cru", () => {
    assert.match(fonte, /data-pf-comparador-processos=\{candidato\.total_processos\}/)
    assert.match(fonte, /candidato\.total_processos === max/)
    assert.match(fonte, /candidato\.total_processos > 0/)
  })
})

describe("CandidatoProfileSkeleton: a legenda não pode sumir na primeira pintura", () => {
  const fonte = readFileSync("src/components/DeferredCandidatoProfileClient.tsx", "utf-8")

  it("renderiza .sub junto com .value, calculando o display uma vez só", () => {
    // Só .value fazia o "—" aparecer sem "não verificado" durante o
    // carregamento, reintroduzindo a afirmação de ficha limpa que a PR desfaz.
    assert.match(fonte, /const processosDisplay = processosOverviewDisplay\(overview\.processos\)/)
    assert.match(fonte, /processosDisplay\.sub &&/)
    assert.doesNotMatch(fonte, /processosOverviewDisplay\(overview\.processos\)\.value/)
  })

  it("o atributo cru de overview segue intacto", () => {
    assert.match(fonte, /data-pf-overview-raw=\{overview\.processos\}/)
  })
})
