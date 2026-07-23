import assert from "node:assert/strict"
import test from "node:test"

import {
  analyzePartyTimelineRows,
  deriveConsistentPartyTimelineRow,
  normalizePartyTimelineRows,
} from "../scripts/lib/party-timeline-consistency"

test("deriveConsistentPartyTimelineRow uses the latest known timeline row before a TSE-observed change", () => {
  const knownRows = [
    {
      id: "2017-psb",
      partido_anterior: "PCdoB",
      partido_novo: "PSB",
      ano: 2017,
      data_mudanca: null,
      contexto: "Saiu do PCdoB após 30 anos",
    },
    {
      id: "2019-solid",
      partido_anterior: "PSB",
      partido_novo: "Solidariedade",
      ano: 2019,
      data_mudanca: null,
      contexto: null,
    },
  ]

  const inferred = deriveConsistentPartyTimelineRow(
    {
      id: "2022-pdt",
      partido_anterior: "PCDOB",
      partido_novo: "PDT",
      ano: 2022,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2022)",
    },
    knownRows
  )

  assert.equal(inferred.partido_anterior, "Solidariedade")
  assert.equal(inferred.partido_novo, "PDT")
})

test("deriveConsistentPartyTimelineRow canonicalizes labels even outside the TSE-observed path", () => {
  const inferred = deriveConsistentPartyTimelineRow(
    {
      id: "manual-pcdob",
      partido_anterior: "PCDOB",
      partido_novo: "PSB",
      ano: 2017,
      data_mudanca: null,
      contexto: "Curadoria manual",
    },
    []
  )

  assert.equal(inferred.partido_anterior, "PCdoB")
  assert.equal(inferred.partido_novo, "PSB")
})

test("normalizePartyTimelineRows mantém Aldo Rebelo consistente após entrada intermediária PDT", () => {
  const normalized = normalizePartyTimelineRows([
    {
      id: "2017-psb",
      partido_anterior: "PCDOB",
      partido_novo: "PSB",
      ano: 2017,
      data_mudanca: null,
      contexto: "Saiu do PCdoB após 30 anos",
    },
    {
      id: "2019-solid",
      partido_anterior: "PSB",
      partido_novo: "Solidariedade",
      ano: 2019,
      data_mudanca: null,
      contexto: null,
    },
    {
      id: "2022-pdt",
      partido_anterior: "Solidariedade",
      partido_novo: "PDT",
      ano: 2022,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2022)",
    },
    {
      id: "2025-dc",
      partido_anterior: "Solidariedade",
      partido_novo: "DC",
      ano: 2025,
      data_mudanca: "2025-05-01",
      contexto: "Filiou-se ao DC para disputar a Presidência",
    },
  ])

  assert.equal(normalized[2].partido_anterior, "Solidariedade")
  assert.equal(normalized[2].partido_novo, "PDT")
  assert.equal(normalized[3].partido_anterior, "PDT")
  assert.equal(normalized[3].partido_novo, "DC")
})

test("normalizePartyTimelineRows aplica a mesma regra para casos análogos sem depender do contexto TSE na linha posterior", () => {
  const normalized = normalizePartyTimelineRows([
    {
      id: "2005-b",
      partido_anterior: "A",
      partido_novo: "B",
      ano: 2005,
      data_mudanca: null,
      contexto: "Curadoria manual",
    },
    {
      id: "2010-c",
      partido_anterior: "B",
      partido_novo: "C",
      ano: 2010,
      data_mudanca: null,
      contexto: "Curadoria manual",
    },
    {
      id: "2015-d",
      partido_anterior: "B",
      partido_novo: "D",
      ano: 2015,
      data_mudanca: null,
      contexto: "Curadoria manual",
    },
  ])

  assert.equal(normalized[2].partido_anterior, "C")
  assert.equal(normalized[2].partido_novo, "D")
})

test("analyzePartyTimelineRows classifica alias seguro sem forçar reencadeamento", () => {
  const [decision] = analyzePartyTimelineRows([
    {
      id: "2021-pode",
      partido_anterior: "Sem partido",
      partido_novo: "PODEMOS",
      ano: 2021,
      data_mudanca: "2021-01-01",
      contexto: "Wikidata P102 (filiação inicial conhecida)",
    },
  ])

  assert.equal(decision.category, "alias_seguro")
  assert.equal(decision.autoApply, true)
  assert.equal(decision.applyKind, "alias")
  assert.equal(decision.normalized.partido_novo, "PODE")
})

test("analyzePartyTimelineRows bloqueia renomeação histórica do mesmo partido", () => {
  const decisions = analyzePartyTimelineRows([
    {
      id: "1988-psdb",
      partido_anterior: "MDB",
      partido_novo: "PSDB",
      ano: 1988,
      data_mudanca: "1988-01-01",
      contexto: "Wikidata P102",
    },
    {
      id: "1996-cidadania",
      partido_anterior: "PSDB",
      partido_novo: "CIDADANIA",
      ano: 1996,
      data_mudanca: "1996-01-01",
      contexto: "Wikidata P102",
    },
    {
      id: "1997-pps",
      partido_anterior: "PSDB",
      partido_novo: "PPS",
      ano: 1997,
      data_mudanca: null,
      contexto: "Rompeu com FHC",
    },
  ])

  const blocked = decisions.at(-1)
  assert.ok(blocked)
  assert.equal(blocked.category, "renomeacao_historica_mesmo_partido")
  assert.equal(blocked.autoApply, false)
  assert.equal(blocked.normalized.partido_anterior, "PSDB")
  assert.equal(blocked.legacyNormalized.partido_anterior, "CIDADANIA")
})

test("analyzePartyTimelineRows marca cronologia ambígua como suspeita em vez de reencadear", () => {
  const decisions = analyzePartyTimelineRows([
    {
      id: "2020-pode",
      partido_anterior: "PRB",
      partido_novo: "PODE",
      ano: 2020,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2020)",
    },
    {
      id: "2022-a",
      partido_anterior: "PV",
      partido_novo: "PL",
      ano: 2022,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2022)",
    },
    {
      id: "2022-b",
      partido_anterior: "PODE",
      partido_novo: "PV",
      ano: 2022,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2022)",
    },
  ])

  const blocked = decisions[2]
  assert.equal(blocked.category, "suspeito_precisa_revisao")
  assert.equal(blocked.autoApply, false)
  assert.equal(blocked.normalized.partido_anterior, "PODE")
  assert.equal(blocked.legacyNormalized.partido_anterior, "PL")
})

test("analyzePartyTimelineRows mantém reencadeamento automático quando a cadeia anterior é inequívoca", () => {
  const decisions = analyzePartyTimelineRows([
    {
      id: "2009-mdb",
      partido_anterior: "Sem partido",
      partido_novo: "MDB",
      ano: 2009,
      data_mudanca: "2009-01-01",
      contexto: "Wikidata P102 (filiação inicial conhecida)",
    },
    {
      id: "2018-dem",
      partido_anterior: "MDB",
      partido_novo: "DEMOCRATAS",
      ano: 2018,
      data_mudanca: "2018-01-01",
      contexto: "Wikidata P102",
    },
    {
      id: "2020-patriota",
      partido_anterior: "DEM",
      partido_novo: "PATRIOTA",
      ano: 2020,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2020)",
    },
    {
      id: "2021-psd",
      partido_anterior: "DEMOCRATAS",
      partido_novo: "PSD",
      ano: 2021,
      data_mudanca: "2021-10-27",
      contexto: "Wikidata P102",
    },
  ])

  const safe = decisions.at(-1)
  assert.ok(safe)
  assert.equal(safe.category, "reencadeamento_real")
  assert.equal(safe.autoApply, true)
  assert.equal(safe.applyKind, "rechain")
  assert.equal(safe.normalized.partido_anterior, "PATRIOTA")
})

test("analyzePartyTimelineRows bloqueia reencadeamento depois de um cluster ambíguo anterior", () => {
  const decisions = analyzePartyTimelineRows([
    {
      id: "2018-prb",
      partido_anterior: "PSDB",
      partido_novo: "PRB",
      ano: 2018,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2018)",
    },
    {
      id: "2020-a",
      partido_anterior: "PSB",
      partido_novo: "PP",
      ano: 2020,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2020)",
    },
    {
      id: "2020-b",
      partido_anterior: "PRB",
      partido_novo: "PSB",
      ano: 2020,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2020)",
    },
    {
      id: "2022-republicanos",
      partido_anterior: "PP",
      partido_novo: "REPUBLICANOS",
      ano: 2022,
      data_mudanca: null,
      contexto: "Mudança observada entre eleições TSE (2022)",
    },
  ])

  const blocked = decisions.at(-1)
  assert.ok(blocked)
  assert.equal(blocked.category, "suspeito_precisa_revisao")
  assert.equal(blocked.autoApply, false)
  assert.equal(blocked.reason, "ambiguous_prior_cluster")
  assert.equal(blocked.normalized.partido_anterior, "PP")
  assert.equal(blocked.legacyNormalized.partido_anterior, "PSB")
})
