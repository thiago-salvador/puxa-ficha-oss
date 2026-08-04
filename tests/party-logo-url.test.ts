import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { getPartyLogoUrl } from "@/lib/utils"

describe("getPartyLogoUrl", () => {
  it("keeps local static logos for existing party assets", () => {
    assert.equal(getPartyLogoUrl("PT"), "/partidos/pt.png")
    assert.equal(getPartyLogoUrl("AVANTE"), "/partidos/avante.png")
  })

  it("serve local os logos que antes vinham da Wikimedia (G5-09)", () => {
    assert.equal(getPartyLogoUrl("MOBILIZA"), "/partidos/mobiliza.png")
    assert.equal(getPartyLogoUrl("PMN"), "/partidos/mobiliza.png")
    assert.equal(getPartyLogoUrl("PCB"), "/partidos/pcb.png")
    assert.equal(getPartyLogoUrl("PODE"), "/partidos/pode.png")
  })

  it("nenhum logo de partido depende de host de terceiro", () => {
    for (const sigla of ["MOBILIZA", "PMN", "PCB", "PODE", "PT", "NOVO", "PSTU"]) {
      const url = getPartyLogoUrl(sigla)
      assert.ok(url && url.startsWith("/partidos/"), `${sigla} -> ${url}`)
    }
  })

  it("keeps unknown parties logo-less instead of inventing an asset", () => {
    assert.equal(getPartyLogoUrl("SEM LOGO"), null)
  })
})
