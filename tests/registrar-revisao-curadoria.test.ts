import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  entradaDaRevisao,
  validarRevisaoManual
} from "../scripts/registrar-revisao-curadoria"

const base = [
  "--slug=fulano",
  "--frente=contradicoes",
  "--data=2026-08-05",
  "--resultado=sem_achado_no_escopo",
  "--detalhe=órgãos: Câmara; jurisdição: nacional; período: até 2026-08-05; termos: nome completo + cargo + UF",
  "--identidade=cargo-e-uf",
  "--identidade-url=https://example.org/perfil-oficial",
  "--url=https://example.org/perfil-oficial",
  "--url=https://example.org/busca"
]

describe("registrar revisão manual valida procedência antes de escrever", () => {
  it("recusa revisão sem fonte", () => {
    assert.throws(
      () => validarRevisaoManual(base.filter((arg) => !arg.startsWith("--url="))),
      /--url exige ao menos uma fonte não vazia/
    )
  })

  it("recusa slug com sintaxe inválida", () => {
    const args = base.map((arg) => arg === "--slug=fulano" ? "--slug=Nome Completo" : arg)
    assert.throws(() => validarRevisaoManual(args), /--slug inválido/)
  })

  it("recusa encontrado sem evidência publicável", () => {
    const args = base
      .map((arg) => arg === "--resultado=sem_achado_no_escopo" ? "--resultado=encontrado" : arg)
    assert.throws(() => validarRevisaoManual(args), /--evidencia-publicavel/)
  })

  it("recusa nome sozinho como prova de identidade", () => {
    const args = base.map((arg) => arg === "--identidade=cargo-e-uf" ? "--identidade=nome" : arg)
    assert.throws(() => validarRevisaoManual(args), /nome sozinho não prova identidade/)
  })

  it("recusa CPF no detalhe antes de qualquer saída", () => {
    const args = base.map((arg) =>
      arg.startsWith("--detalhe=") ? "--detalhe=CPF consultado" : arg
    )
    assert.throws(() => validarRevisaoManual(args), /não pode conter CPF/)
  })

  it("recusa ausência comprovada para contradições", () => {
    const args = base.map((arg) =>
      arg === "--resultado=sem_achado_no_escopo" ? "--resultado=vazio_confirmado" : arg
    )
    assert.throws(() => validarRevisaoManual(args), /não aceita ausência comprovada/)
  })

  it("processo vazio exige escopo estruturado no detalhe", () => {
    const args = base.map((arg) => {
      if (arg === "--frente=contradicoes") return "--frente=processos"
      if (arg === "--resultado=sem_achado_no_escopo") return "--resultado=vazio_confirmado"
      if (arg.startsWith("--detalhe=")) return "--detalhe=busca completa"
      return arg
    })
    assert.throws(() => validarRevisaoManual(args), /escopo real no detalhe/)
  })

  it("dry-run é padrão e a entrada usa a fonte de curadoria", () => {
    const revisao = validarRevisaoManual(base)
    assert.equal(revisao.apply, false)
    assert.deepEqual(entradaDaRevisao(revisao), {
      fonte: "contradicoes-curadoria",
      alvo: "fulano",
      resultado: "sem_achado_no_escopo",
      volume: 0,
      detalhe:
        "revisao_em=2026-08-05; identidade=cargo-e-uf; identidade_urls=https://example.org/perfil-oficial; urls_consultadas=https://example.org/perfil-oficial,https://example.org/busca; detalhe=órgãos: Câmara; jurisdição: nacional; período: até 2026-08-05; termos: nome completo + cargo + UF",
      url: "https://example.org/perfil-oficial"
    })
  })

  it("encontrado exige e preserva evidência publicável consultada", () => {
    const args = [
      ...base.map((arg) =>
        arg === "--resultado=sem_achado_no_escopo" ? "--resultado=encontrado" : arg
      ),
      "--evidencia-publicavel=https://example.org/busca"
    ]
    const entrada = entradaDaRevisao(validarRevisaoManual(args))
    assert.equal(entrada.resultado, "encontrado")
    assert.equal(entrada.volume, 1)
  })
})
