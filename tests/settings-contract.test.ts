import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { join } from "node:path"

const root = process.cwd()

const settingsFiles = [
  "README.md",
  "OBJECTIVE.md",
  "EXPECTED_BEHAVIOR.md",
  "ARCHITECTURE.md",
  "STACK.md",
  "SOURCES_AND_DATA.md",
  "WORKFLOWS.md",
  "AUTOMATIONS_AND_ENVIRONMENTS.md",
  "STATUS.md",
] as const

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8")
}

test("Settings expõe todos os documentos canônicos na ordem de leitura", () => {
  const index = read("Settings/README.md")

  for (const file of settingsFiles) {
    assert.doesNotThrow(() => read(`Settings/${file}`))
  }

  for (const file of settingsFiles.filter((file) => file !== "README.md")) {
    assert.match(index, new RegExp(file.replace(".", "\\.")))
  }
})

test("arquivos de agentes apontam para a configuração canônica", () => {
  for (const file of ["AGENTS.md", "CLAUDE.md", "QWEN.md"]) {
    assert.match(read(file), /Settings\/README\.md/)
  }
})

test("objetivo protege universo, frontend e estados de cobertura", () => {
  const objective = read("Settings/OBJECTIVE.md")

  assert.match(objective, /todos os candidatos à Presidência/)
  assert.match(objective, /governos de todos os estados/)
  assert.match(objective, /frontend/)
  assert.match(objective, /vazio_confirmado/)
  assert.match(objective, /nao_aplicavel/)
  assert.match(objective, /nao_coletado/)
  assert.match(objective, /readback público/)
})
