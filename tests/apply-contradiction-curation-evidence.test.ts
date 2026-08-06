import assert from "node:assert/strict"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  escreverEvidenciaAtomica,
  validarCoorteEvidencia,
} from "../scripts/apply-contradiction-curation-evidence"

describe("aplicador da evidência de contradições", () => {
  it("aceita exatamente os mesmos slugs em ordem diferente", () => {
    assert.doesNotThrow(() =>
      validarCoorteEvidencia(
        ["candidato-a", "candidato-b", "candidato-c"],
        ["candidato-c", "candidato-a", "candidato-b"],
      ),
    )
  })

  it("rejeita slug duplicado na coorte", () => {
    assert.throws(
      () => validarCoorteEvidencia(["candidato-a", "candidato-a"], ["candidato-a"]),
      /slugs duplicados na coorte: candidato-a/,
    )
  })

  it("rejeita slug duplicado nos candidatos", () => {
    assert.throws(
      () => validarCoorteEvidencia(["candidato-a"], ["candidato-a", "candidato-a"]),
      /slugs duplicados nos candidatos: candidato-a/,
    )
  })

  it("rejeita troca de candidato mesmo quando a cardinalidade coincide", () => {
    assert.throws(
      () =>
        validarCoorteEvidencia(
          ["candidato-a", "candidato-b"],
          ["candidato-a", "candidato-c"],
        ),
      /ausentes=candidato-b; extras=candidato-c/,
    )
  })

  it("cria evidência atômica com modo 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "contradicoes-evidence-"))
    try {
      const evidencePath = join(dir, "evidence.json")
      escreverEvidenciaAtomica(evidencePath, { status: "concluido" })

      assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), {
        status: "concluido",
      })
      assert.equal(statSync(evidencePath).mode & 0o777, 0o600)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("corrige para 0600 ao substituir evidência permissiva", () => {
    const dir = mkdtempSync(join(tmpdir(), "contradicoes-evidence-"))
    try {
      const evidencePath = join(dir, "evidence.json")
      writeFileSync(evidencePath, '{"status":"parcial"}\n', "utf8")
      chmodSync(evidencePath, 0o644)

      escreverEvidenciaAtomica(evidencePath, { status: "concluido" })

      assert.equal(statSync(evidencePath).mode & 0o777, 0o600)
      assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), {
        status: "concluido",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
