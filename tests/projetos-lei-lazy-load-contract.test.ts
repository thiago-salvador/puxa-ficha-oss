import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, test } from "node:test"

const API_PATH = "src/lib/api.ts"
const PROFILE_PATH = "src/components/CandidatoProfile.tsx"
const ROUTE_PATH = "src/app/api/candidato-profile/[slug]/projetos-lei/route.ts"

describe("inventário de projetos de lei sob demanda", () => {
  test("a ficha inicial limita projetos e preserva a contagem exata", async () => {
    const source = await readFile(API_PATH, "utf8")
    const initialQuery = source.slice(
      source.indexOf("withSupabaseRetry(`projetos_lei(${slug})`"),
      source.indexOf("withSupabaseRetry(`legislacao_mandato_executivo(${slug})`"),
    )

    assert.match(initialQuery, /select\("\*", \{ count: "exact" \}\)/)
    assert.match(initialQuery, /\.limit\(25\)/)
    assert.match(source, /projetos_lei_total: projetos\.count/)
    assert.match(source, /projetos_lei_truncados:/)
  })

  test("o endpoint público limita cada página a 100 e sanitiza a saída", async () => {
    const [api, route] = await Promise.all([
      readFile(API_PATH, "utf8"),
      readFile(ROUTE_PATH, "utf8"),
    ])

    assert.match(api, /const safeLimit = Math\.min\(100,/)
    assert.match(api, /\.range\(safeOffset, safeOffset \+ safeLimit - 1\)/)
    assert.match(route, /toPublicProjetosLeiDto\(resource\.data\.rows\)/)
    assert.doesNotMatch(route, /createServiceRoleSupabaseClient/)
  })

  test("o cliente só busca todas as páginas quando Legislação é aberta", async () => {
    const [source, sections] = await Promise.all([
      readFile(PROFILE_PATH, "utf8"),
      readFile("src/components/CandidatoProfileSections.tsx", "utf8"),
    ])

    assert.match(source, /activeTab !== "legislacao"/)
    assert.match(source, /while \(offset < total\)/)
    assert.match(source, /projetos_lei_fetch_incomplete/)
    assert.match(sections, /projetosLeiLoadState === "failed"/)
  })
})
