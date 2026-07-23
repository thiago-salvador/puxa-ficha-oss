import assert from "node:assert"
import { test, describe } from "node:test"
import { aggregatePlCountsByQuizEixo, mapProjetoTemaToQuizEixo } from "@/lib/quiz-tema-map"
import { readFileSync } from "fs"

function extractProjectIngestRow(content: string): string {
  const projectUpsertIndex = content.indexOf('.from("projetos_lei")')
  assert.notStrictEqual(projectUpsertIndex, -1, "ingest deve escrever em projetos_lei")

  const rowStart = content.lastIndexOf("const row = {", projectUpsertIndex)
  assert.notStrictEqual(rowStart, -1, "ingest deve montar objeto row antes do upsert de projetos_lei")

  const braceStart = content.indexOf("{", rowStart)
  let depth = 0
  for (let index = braceStart; index < content.length; index++) {
    const char = content[index]
    if (char === "{") depth++
    if (char === "}") depth--
    if (depth === 0) {
      return content.slice(rowStart, index + 1)
    }
  }

  throw new Error("nao foi possivel extrair objeto row de projetos_lei")
}

function assertRawProjectIngestRow(content: string, sourceLabel: string, sourceValue: string) {
  const row = extractProjectIngestRow(content)

  for (const field of ["tipo", "numero", "ano", "ementa", "fonte", "proposicao_id_api"]) {
    assert.match(row, new RegExp(`\\b${field}\\b\\s*(?::|,)`), `${sourceLabel} ingest escreve ${field}`)
  }

  assert.match(row, new RegExp(`\\bfonte:\\s*"${sourceValue}"`), `${sourceLabel} ingest escreve fonte correta`)
  assert.doesNotMatch(row, /\btema:\s*/, `${sourceLabel} ingest não deve escrever tema`)
  assert.doesNotMatch(row, /\bdestaque:\s*/, `${sourceLabel} ingest não deve escrever destaque`)
  assert.doesNotMatch(row, /\bdestaque_motivo:\s*/, `${sourceLabel} ingest não deve escrever destaque_motivo`)
}

describe("Projetos de lei contract", () => {
  describe("src/lib/types.ts", () => {
    test("existe export interface ProjetoLei", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /export interface ProjetoLei/, "deve exportar interface ProjetoLei")
    })

    test("ProjetoLei contém campo id", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /id:\s*string/, "deve ter campo id")
    })

    test("ProjetoLei contém campo candidato_id", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /candidato_id:\s*string/, "deve ter campo candidato_id")
    })

    test("ProjetoLei contém campo tipo", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /tipo:\s*string/, "deve ter campo tipo")
    })

    test("ProjetoLei contém campo numero", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /numero:\s*string\s*\|/, "deve ter campo numero")
    })

    test("ProjetoLei contém campo ano", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /ano:\s*number\s*\|/, "deve ter campo ano")
    })

    test("ProjetoLei contém campo ementa", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /ementa:\s*string\s*\|/, "deve ter campo ementa")
    })

    test("ProjetoLei contém campo tema (enriquecimento editorial)", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /tema:\s*string\s*\|/, "deve ter campo tema (enriquecimento editorial)")
    })

    test("ProjetoLei contém campo situacao", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /situacao:\s*string\s*\|/, "deve ter campo situacao")
    })

    test("ProjetoLei contém campo url_inteiro_teor", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /url_inteiro_teor:\s*string\s*\|/, "deve ter campo url_inteiro_teor")
    })

    test("ProjetoLei contém campo destaque (enriquecimento editorial)", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /destaque:\s*boolean/, "deve ter campo destaque (enriquecimento editorial)")
    })

    test("ProjetoLei contém campo destaque_motivo (enriquecimento editorial)", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /destaque_motivo:\s*string\s*\|/, "deve ter campo destaque_motivo (enriquecimento editorial)")
    })

    test("ProjetoLei contém campo fonte", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /fonte:\s*string/, "deve ter campo fonte")
    })

    test("ProjetoLei contém campo proposicao_id_api (para audit/dedupe)", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /proposicao_id_api\??:\s*string\s*\|\s*null/, "deve ter campo proposicao_id_api para audit/dedupe")
    })

    test("ProjetoLei contém campo coverage_id (etiqueta de cobertura parlamentar)", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /coverage_id\??:\s*string\s*\|\s*null/, "deve ter campo coverage_id para cobertura parlamentar verificada")
    })

    test("ProjetoLei contém campo coverage_scope (escopo formal do coverage_id)", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /coverage_scope\??:\s*string\s*\|\s*null/, "deve ter campo coverage_scope")
    })

    test("ProjetoLei contém campo metadata (provenance auditável)", () => {
      const content = readFileSync("src/lib/types.ts", "utf-8")
      assert.match(content, /metadata\??:\s*Record<string,\s*unknown>\s*\|\s*null/, "deve ter campo metadata para provenance")
    })
  })

  describe("Contrato de bruto vs enriquecido", () => {
    test("ingest oficial Câmara/Senado produz legislação bruta (tipo, numero, ano, ementa, fonte, proposicao_id_api)", () => {
      const camaraContent = readFileSync("scripts/lib/ingest-camara.ts", "utf-8")
      const senadoContent = readFileSync("scripts/lib/ingest-senado.ts", "utf-8")

      assertRawProjectIngestRow(camaraContent, "Camara", "Camara")
      assertRawProjectIngestRow(senadoContent, "Senado", "Senado")
    })

    test("tema, destaque e destaque_motivo são enriquecimento editorial/curatorial, não produzidos por ingest oficial", () => {
      const camaraContent = readFileSync("scripts/lib/ingest-camara.ts", "utf-8")
      const senadoContent = readFileSync("scripts/lib/ingest-senado.ts", "utf-8")

      assertRawProjectIngestRow(camaraContent, "Camara", "Camara")
      assertRawProjectIngestRow(senadoContent, "Senado", "Senado")
    })

    test("quiz só consome projetos_lei com tema (tema não nulo)", () => {
      const apiContent = readFileSync("src/lib/api.ts", "utf-8")
      assert.match(apiContent, /\.not\("tema", "is", null\)/, "quiz dataset deve ignorar tema nulo")
    })

    test("UI de legislação ordena com destaque primeiro, mas não trata ausência de tema/destaque como erro factual", () => {
      const sectionsContent = readFileSync("src/components/CandidatoProfileSections.tsx", "utf-8")
      // UI uses destaque for ordering but handles missing gracefully
      assert.match(sectionsContent, /if \(a\.destaque && !b\.destaque\) return -1/, "UI ordena destaque primeiro")
      // No assertion that destaque or tema must be present - absence is acceptable
    })
  })

  describe("src/lib/api.ts", () => {
    test("a ficha busca a tabela projetos_lei", () => {
      const content = readFileSync("src/lib/api.ts", "utf-8")
      assert.match(content, /from\("projetos_lei"\)/, "deve consultar tabela projetos_lei")
    })

    test("a query filtra por candidato_id", () => {
      const content = readFileSync("src/lib/api.ts", "utf-8")
      assert.match(content, /\.eq\("candidato_id", id\)/, "deve filtrar por candidato_id")
    })

    test("a query ordena por ano descendente", () => {
      const content = readFileSync("src/lib/api.ts", "utf-8")
      assert.match(content, /\.order\("ano", \{ ascending: false \}\)/, "deve ordenar por ano descendente")
    })

    test("a montagem da ficha popula projetos_lei: projetos.data", () => {
      const content = readFileSync("src/lib/api.ts", "utf-8")
      assert.match(content, /projetos_lei:\s*projetos\.data/, "deve popular projetos_lei")
    })

    test("o dataset do quiz busca candidato_id, tema, url_inteiro_teor em projetos_lei", () => {
      const content = readFileSync("src/lib/api.ts", "utf-8")
      assert.match(content, /select\("candidato_id,tema,url_inteiro_teor"\)/, "deve buscar campos específicos para quiz")
    })

    test("o dataset do quiz ignora tema nulo", () => {
      const content = readFileSync("src/lib/api.ts", "utf-8")
      assert.match(content, /\.not\("tema", "is", null\)/, "deve ignorar tema nulo")
    })
  })

  describe("src/lib/timeline-utils.ts", () => {
    test("computeProcessYearFallback considera ficha.projetos_lei", () => {
      const content = readFileSync("src/lib/timeline-utils.ts", "utf-8")
      assert.match(content, /ficha\.projetos_lei/, "deve considerar projetos_lei no fallback")
    })

    test("buildTimelineEvents percorre ficha.projetos_lei", () => {
      const content = readFileSync("src/lib/timeline-utils.ts", "utf-8")
      assert.match(content, /for \(const pl of ficha\.projetos_lei/, "deve percorrer projetos_lei")
    })

    test("projeto sem ano é ignorado na timeline", () => {
      const content = readFileSync("src/lib/timeline-utils.ts", "utf-8")
      assert.match(content, /if \(pl\.ano == null\) continue/, "deve ignorar projeto sem ano")
    })

    test("evento de projeto usa id no formato pl-${pl.id}", () => {
      const content = readFileSync("src/lib/timeline-utils.ts", "utf-8")
      assert.match(content, /id: `pl-\$\{pl\.id\}`/, "deve usar formato pl-${pl.id}")
    })

    test("evento de projeto usa type: projeto_lei", () => {
      const content = readFileSync("src/lib/timeline-utils.ts", "utf-8")
      assert.match(content, /type:\s*"projeto_lei"/, "deve usar type projeto_lei")
    })

    test("evento de projeto aponta tab_link: legislacao", () => {
      const content = readFileSync("src/lib/timeline-utils.ts", "utf-8")
      assert.match(content, /tab_link:\s*"legislacao"/, "deve apontar para aba legislacao")
    })
  })

  describe("src/lib/quiz-tema-map.ts", () => {
    test("exporta mapProjetoTemaToQuizEixo", () => {
      const content = readFileSync("src/lib/quiz-tema-map.ts", "utf-8")
      assert.match(content, /export function mapProjetoTemaToQuizEixo/, "deve exportar mapProjetoTemaToQuizEixo")
      assert.strictEqual(mapProjetoTemaToQuizEixo("segurança pública"), "seguranca")
    })

    test("exporta aggregatePlCountsByQuizEixo", () => {
      const content = readFileSync("src/lib/quiz-tema-map.ts", "utf-8")
      assert.match(content, /export function aggregatePlCountsByQuizEixo/, "deve exportar aggregatePlCountsByQuizEixo")
    })

    test("aggregatePlCountsByQuizEixo chama mapProjetoTemaToQuizEixo", () => {
      const content = readFileSync("src/lib/quiz-tema-map.ts", "utf-8")
      assert.match(content, /mapProjetoTemaToQuizEixo\(tema\)/, "deve chamar mapProjetoTemaToQuizEixo")
    })

    test("tema tributário/fiscal soma em politica_fiscal", () => {
      const result = aggregatePlCountsByQuizEixo({ "tributário": 2, "fiscal": 1 })
      assert.strictEqual(result.politica_fiscal, 3, "temas tributário/fiscal devem somar em politica_fiscal")
    })

    test("tema de segurança soma em seguranca", () => {
      const result = aggregatePlCountsByQuizEixo({ "segurança pública": 3 })
      assert.strictEqual(result.seguranca, 3, "tema de segurança deve somar em seguranca")
    })

    test("tema desconhecido é ignorado", () => {
      const result = aggregatePlCountsByQuizEixo({ "tema desconhecido": 5 })
      assert.strictEqual(Object.keys(result).length, 0, "tema desconhecido deve ser ignorado")
    })
  })

  describe("src/components/CandidatoProfileSections.tsx", () => {
    test("a seção de legislação recebe projetosLei", () => {
      const content = readFileSync("src/components/CandidatoProfileSections.tsx", "utf-8")
      assert.match(content, /projetosLei:\s*ProjetoLei\[\]/, "deve receber projetosLei")
    })

    test("renderiza Projetos de lei ({projetosLei.length})", () => {
      const content = readFileSync("src/components/CandidatoProfileSections.tsx", "utf-8")
      assert.match(content, /Projetos de lei \(\$\{items\.length\}\)/, "deve renderizar contagem")
    })

    test("ordena visualmente com destaque primeiro", () => {
      const content = readFileSync("src/components/CandidatoProfileSections.tsx", "utf-8")
      assert.match(content, /if \(a\.destaque && !b\.destaque\) return -1/, "deve ordenar destaque primeiro")
    })

    test("usa safeHref antes de renderizar link externo", () => {
      const content = readFileSync("src/components/CandidatoProfileSections.tsx", "utf-8")
      assert.match(content, /safeHref\(projeto\.url_inteiro_teor\)/, "deve usar safeHref antes de renderizar link")
    })
  })
})
