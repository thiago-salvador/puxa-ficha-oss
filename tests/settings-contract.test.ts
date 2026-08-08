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
  "CANDIDATE_DATA_COMPLETENESS_WORKFLOW.md",
  "CANDIDATE_DATA_COMPLETENESS_EVAL.md",
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

test("toda task precisa demonstrar avanço de completude ou confiabilidade", () => {
  const objective = read("Settings/OBJECTIVE.md")
  const workflow = read("Settings/WORKFLOWS.md")
  const agents = read("AGENTS.md")

  assert.match(objective, /Toda task feita neste projeto/)
  assert.match(objective, /base\s+mais completa e confiável possível/)
  assert.match(workflow, /Gate de entrada da task/)
  assert.match(workflow, /Se não houver\s+ligação concreta com o objetivo, não execute a task/)
  assert.match(agents, /Toda task deve demonstrar/)
})

test("o ledger só significa migration aplicada, e escrita fora dela exige trilha", () => {
  const workflow = read("Settings/WORKFLOWS.md")
  const decisao = read("docs/arquivo/decisao-trilha-de-escrita-20260808.md")

  // O ledger tem um significado só, e a política diz qual.
  assert.match(workflow, /supabase_migrations\.schema_migrations/)
  assert.match(workflow, /significa uma coisa só:\s*\n?migration aplicada/)

  // O helper é nomeado pelo caminho real, não descrito de longe.
  assert.match(workflow, /escreverAuditado\(\)/)
  assert.match(workflow, /scripts\/lib\/escrita-auditada\.ts/)
  assert.match(workflow, /scripts\/audit\/lib\/escrita-auditada-gate\.ts/)

  // A decisão e as alternativas descartadas moram em docs/, e Settings aponta.
  assert.match(workflow, /docs\/arquivo\/decisao-trilha-de-escrita-20260808\.md/)
  for (const opcao of [/db push/, /ledger/, /Trilha separada/, /Só o guard/]) {
    assert.match(decisao, opcao)
  }
  assert.match(decisao, /Por que as outras três foram descartadas/)
})

test("a ordem de rollout da trilha está escrita e é verificável", () => {
  const workflow = read("Settings/WORKFLOWS.md")
  const status = read("Settings/STATUS.md")

  // Os três passos, na ordem, com a migration antes de qualquer --apply.
  const ordem = workflow.match(/```text\n([\s\S]*?)```/g) ?? []
  const bloco = ordem.find((b) => b.includes("20260808120000"))
  assert.ok(bloco, "WORKFLOWS.md precisa do bloco com a ordem de rollout")
  const passoMigration = bloco.indexOf("20260808120000")
  const passoApply = bloco.indexOf("--apply")
  assert.ok(passoMigration >= 0 && passoApply >= 0, "os dois passos precisam existir")
  assert.ok(
    passoMigration < passoApply,
    "aplicar a migration tem que vir ANTES de rodar script com --apply",
  )

  // A consequência de inverter e o preflight que a torna falha segura.
  assert.match(workflow, /Se a ordem for invertida/)
  assert.match(workflow, /preflight/)

  // STATUS não pode afirmar que a migration está aplicada.
  assert.match(status, /20260808120000/)
  assert.match(status, /\*\*não está aplicada\*\*/)
})

test("workflow de completude protege universo, paralelismo e release", () => {
  const workflow = read("Settings/CANDIDATE_DATA_COMPLETENESS_WORKFLOW.md")
  const evalDoc = read("Settings/CANDIDATE_DATA_COMPLETENESS_EVAL.md")

  assert.match(workflow, /matriz dinâmica `candidato x frente x campo`/)
  assert.match(workflow, /Onda A/)
  assert.match(workflow, /Onda B/)
  assert.match(workflow, /Um único integrador/)
  assert.match(workflow, /readback público/)
  assert.match(workflow, /APROVAR WORKFLOW DE COMPLETUDE/)
  assert.match(workflow, /CANDIDATE_DATA_COMPLETENESS_EVAL\.md/)
  assert.match(evalDoc, /Tipo: automacao/)
  assert.match(evalDoc, /Gate: Done só com 100% PASS/)
  assert.match(evalDoc, /evals\/profile-completeness\/cases\.jsonl/)
})
