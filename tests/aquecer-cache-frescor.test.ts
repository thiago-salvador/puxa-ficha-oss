import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

import { idadeEmHoras, lerCarimbo } from "../scripts/aquecer-cache-publico"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Este bloco existe por causa de um comportamento do ISR medido em 2026-08-04:
 * quando a revalidacao de uma rota cacheada LANCA, o Next NAO devolve erro, ele
 * continua servindo o ultimo snapshot bom. Experimento: rota com revalidate=5,
 * aquecida com sucesso, servidor reiniciado com o render lancando sempre, cache
 * em disco preservado. Resultado: HTTP 200 com o conteudo antigo nas tres
 * requisicoes (STALE, depois HIT).
 *
 * Isso protege o leitor e cega quem opera: o site pode congelar no passado sem
 * emitir um unico sinal. O carimbo `pf-rendered-at` e esse sinal, e estas sao
 * as regras que o interpretam.
 */
describe("frescor do cache publico", () => {
  it("le o carimbo emitido por metadata.other", () => {
    // Formato real, capturado do HTML servido em build de producao local.
    const html = '<meta name="pf-rendered-at" content="2026-08-04T10:48:39.062Z"/>'
    assert.equal(lerCarimbo(html), "2026-08-04T10:48:39.062Z")
  })

  it("le o carimbo com os atributos invertidos", () => {
    const html = '<meta content="2026-08-04T10:48:39.062Z" name="pf-rendered-at"/>'
    assert.equal(lerCarimbo(html), "2026-08-04T10:48:39.062Z")
  })

  it("devolve null quando nao ha carimbo", () => {
    assert.equal(lerCarimbo("<html><head><title>x</title></head></html>"), null)
    assert.equal(lerCarimbo(""), null)
    // Meta de outro nome nao pode ser confundida com a nossa.
    assert.equal(lerCarimbo('<meta name="description" content="2026-01-01T00:00:00Z"/>'), null)
  })

  it("calcula idade em horas a partir do carimbo", () => {
    const agora = Date.parse("2026-08-04T12:00:00.000Z")
    assert.equal(idadeEmHoras("2026-08-04T12:00:00.000Z", agora), 0)
    assert.equal(idadeEmHoras("2026-08-04T09:00:00.000Z", agora), 3)
    assert.equal(idadeEmHoras("2026-08-03T12:00:00.000Z", agora), 24)
  })

  it("distingue ausencia de carimbo de carimbo velho", () => {
    const agora = Date.parse("2026-08-04T12:00:00.000Z")
    // null significa "nao sei", e o script trata como aviso, nao como alerta:
    // ficha sem carimbo costuma ser deploy anterior ainda em cache.
    assert.equal(idadeEmHoras(null, agora), null)
    assert.equal(idadeEmHoras("nao-e-data", agora), null)
    // Carimbo velho e outra coisa: e revalidacao falhando em serie.
    const idade = idadeEmHoras("2026-08-04T02:00:00.000Z", agora)
    assert.equal(idade, 10)
    assert.ok(idade !== null && idade > 4, "10h precisa estourar um teto de 4h")
  })

  it("a ficha carimba pf-rendered-at, senao a checagem nao tem o que ler", () => {
    const page = readFileSync(
      join(root, "src/app/(site)/candidato/[slug]/page.tsx"),
      "utf8",
    )
    assert.match(page, /"pf-rendered-at":\s*new Date\(\)\.toISOString\(\)/)
  })

  it("o workflow agendado roda o aquecimento COM a checagem de frescor", () => {
    // A checagem so e valida acoplada ao aquecimento: sem tocar todas as fichas,
    // carimbo velho significa apenas "ninguem visitou", nao incidente.
    const wf = readFileSync(join(root, ".github/workflows/cache-aquecer.yml"), "utf8")
    assert.match(wf, /cache:aquecer/)
    assert.match(wf, /--frescor-max-horas=\d+/)
    assert.match(wf, /schedule:/)
  })
})
