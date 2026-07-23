import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { getPartyLogoUrl } from "@/lib/utils"

describe("getPartyLogoUrl", () => {
  it("keeps local static logos for existing party assets", () => {
    assert.equal(getPartyLogoUrl("PT"), "/partidos/pt.png")
    assert.equal(getPartyLogoUrl("AVANTE"), "/partidos/avante.png")
  })

  it("returns explicit public logo assets for parties missing local PNGs", () => {
    assert.equal(
      getPartyLogoUrl("MOBILIZA"),
      "https://upload.wikimedia.org/wikipedia/commons/7/7f/Logomarca_Partido_Mobiliza.png",
    )
    assert.equal(
      getPartyLogoUrl("PMN"),
      "https://upload.wikimedia.org/wikipedia/commons/7/7f/Logomarca_Partido_Mobiliza.png",
    )
    assert.equal(
      getPartyLogoUrl("PCB"),
      "https://upload.wikimedia.org/wikipedia/commons/d/d5/PCB_Logo.svg",
    )
    assert.equal(
      getPartyLogoUrl("PODE"),
      "https://upload.wikimedia.org/wikipedia/commons/2/2d/Podemos_%28Brasil%29_logo.svg",
    )
  })

  it("keeps unknown parties logo-less instead of inventing an asset", () => {
    assert.equal(getPartyLogoUrl("SEM LOGO"), null)
  })
})
