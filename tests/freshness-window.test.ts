import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()
const apiSrc = readFileSync(join(root, "src/lib/api.ts"), "utf8")
const annotatorSrc = readFileSync(join(root, "scripts/lib/freshness-annotator.ts"), "utf8")

/**
 * Regressao de 2026-08-03 (master review).
 *
 * `PF_CURATION_PHASE` NUNCA foi definida em Production (conferido com
 * `vercel env ls production`), e o default do codigo era o inseguro: a expressao
 * `!IS_LAUNCH_PHASE || idade <= janela` curto-circuitava e TODA ficha carimbava
 * "Dado atual", inclusive uma parada desde 14/04 (111 dias). Nenhum dos 1595
 * testes exercitava os dois ramos.
 *
 * O contrato agora: so `hardening` EXPLICITO desliga a checagem de idade.
 */
describe("selo de frescor: default seguro e janela unica", () => {
  it("o default do app so desliga a checagem com 'hardening' explicito", () => {
    assert.match(
      apiSrc,
      /IS_LAUNCH_PHASE\s*=\s*process\.env\.PF_CURATION_PHASE\?\.trim\(\)\s*!==\s*"hardening"/,
      "o default voltou a ser o inseguro (ausencia da env fingindo frescor)",
    )
    assert.doesNotMatch(
      apiSrc,
      /IS_LAUNCH_PHASE\s*=\s*process\.env\.PF_CURATION_PHASE\s*===\s*"launched"/,
      "forma antiga: ausencia da variavel resultava em 'sempre atual'",
    )
  })

  it("o annotator dos scripts tem o mesmo default seguro", () => {
    assert.match(
      annotatorSrc,
      /PF_CURATION_PHASE\?\.trim\(\)\s*===\s*"hardening"\s*\?\s*"hardening"\s*:\s*"launched"/,
      "o gemeo em scripts/lib divergiu do app",
    )
  })

  it("a janela de frescor e a MESMA nos dois lugares", () => {
    const doApp = apiSrc.match(/const PROFILE_FRESHNESS_WINDOW_DAYS = (\d+)/)
    const doScript = annotatorSrc.match(/const CURATION_STALE_WINDOW_DAYS = (\d+)/)

    assert.ok(doApp, "PROFILE_FRESHNESS_WINDOW_DAYS nao encontrada em src/lib/api.ts")
    assert.ok(doScript, "CURATION_STALE_WINDOW_DAYS nao encontrada no annotator")
    assert.equal(
      doApp[1],
      doScript[1],
      `janelas divergentes: app usa ${doApp[1]} dias e o annotator usa ${doScript[1]}. ` +
        "A ficha publica e o relatorio de curadoria passariam a discordar sobre o que esta defasado.",
    )
  })

  it("o annotator nao tem mais a janela hardcoded no calculo", () => {
    assert.match(
      annotatorSrc,
      /ageMs > CURATION_STALE_WINDOW_DAYS \* 24 \* 60 \* 60 \* 1000/,
      "o calculo voltou a usar numero magico em vez da constante compartilhada",
    )
  })

  it("os dois ramos do selo continuam existindo (nao viraram constante)", () => {
    assert.match(apiSrc, /\? "current" : "stale"/, "o ramo 'stale' sumiu do selo")
    assert.match(
      apiSrc,
      /Revalide este bloco antes de trata-lo como atual|Revalide este bloco antes de tratá-lo como atual/,
      "a mensagem de bloco defasado sumiu",
    )
  })
})
