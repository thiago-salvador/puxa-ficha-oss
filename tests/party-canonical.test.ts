import assert from "node:assert/strict"
import test from "node:test"

import { canonicalPartiesEquivalent, resolveCanonicalParty } from "../scripts/lib/party-canonical"

test("resolveCanonicalParty reconhece PTB como partido canônico", () => {
  const party = resolveCanonicalParty("PTB")
  assert.ok(party)
  assert.equal(party.sigla, "PTB")
  assert.equal(party.nome, "Partido Trabalhista Brasileiro")
})

test("canonicalPartiesEquivalent trata PTB como equivalente a si mesmo", () => {
  assert.equal(canonicalPartiesEquivalent("PTB", "PTB"), true)
  assert.equal(
    canonicalPartiesEquivalent("Partido Trabalhista Brasileiro", "PTB"),
    true
  )
})

test("resolveCanonicalParty reconhece PHS (Partido Humanista da Solidariedade)", () => {
  const party = resolveCanonicalParty("PHS")
  assert.ok(party)
  assert.equal(party.sigla, "PHS")
})

test("canonicalPartiesEquivalent trata PHS como equivalente a si mesmo", () => {
  assert.equal(canonicalPartiesEquivalent("PHS", "PHS"), true)
})

test("resolveCanonicalParty reconhece PRP (Partido Republicano Progressista)", () => {
  const party = resolveCanonicalParty("PRP")
  assert.ok(party)
  assert.equal(party.sigla, "PRP")
  assert.equal(party.nome, "Partido Republicano Progressista")
})

test("canonicalPartiesEquivalent trata PRP como equivalente ao nome oficial", () => {
  assert.equal(canonicalPartiesEquivalent("PRP", "Partido Republicano Progressista"), true)
})

test("resolveCanonicalParty reconhece PRD (Partido Renovação Democrática)", () => {
  const party = resolveCanonicalParty("PRD")
  assert.ok(party)
  assert.equal(party.sigla, "PRD")
  assert.equal(party.nome, "Partido Renovação Democrática")
})

test("canonicalPartiesEquivalent trata PRD como equivalente ao nome oficial", () => {
  assert.equal(canonicalPartiesEquivalent("PRD", "Partido Renovação Democrática"), true)
  assert.equal(canonicalPartiesEquivalent("PRD", "Partido Renovacao Democratica"), true)
})

test("resolveCanonicalParty reconhece PATRIOTA", () => {
  const party = resolveCanonicalParty("PATRIOTA")
  assert.ok(party)
  assert.equal(party.sigla, "PATRIOTA")
})

test("canonicalPartiesEquivalent trata PATRIOTA como equivalente a si mesmo", () => {
  assert.equal(canonicalPartiesEquivalent("PATRIOTA", "PATRIOTA"), true)
})

test("resolveCanonicalParty reconhece DIVERSOS (rótulo editorial ALEP / curadoria)", () => {
  const party = resolveCanonicalParty("Diversos")
  assert.ok(party)
  assert.equal(party.sigla, "DIVERSOS")
})

test("canonicalPartiesEquivalent alinha Diversos ao token canónico DIVERSOS", () => {
  assert.equal(canonicalPartiesEquivalent("Diversos", "DIVERSOS"), true)
})

test("resolveCanonicalParty reconhece REDE (Rede Sustentabilidade)", () => {
  const party = resolveCanonicalParty("REDE")
  assert.ok(party)
  assert.equal(party.sigla, "REDE")
})

test("canonicalPartiesEquivalent trata REDE como equivalente a Rede Sustentabilidade", () => {
  assert.equal(canonicalPartiesEquivalent("REDE", "REDE"), true)
  assert.equal(canonicalPartiesEquivalent("Rede Sustentabilidade", "REDE"), true)
})

test("resolveCanonicalParty reconhece Democrata 35 sem confundir com DEM", () => {
  const party = resolveCanonicalParty("Democrata 35")
  assert.ok(party)
  assert.equal(party.sigla, "D35")
  assert.equal(party.nome, "Democrata")
  assert.equal(canonicalPartiesEquivalent("D35", "Democrata"), true)
  assert.equal(canonicalPartiesEquivalent("D35", "DEM"), false)
})

test("resolveCanonicalParty reconhece AGIR", () => {
  const party = resolveCanonicalParty("Agir 36")
  assert.ok(party)
  assert.equal(party.sigla, "AGIR")
  assert.equal(party.nome, "Agir")
})

test("PMN e MOBILIZA são entradas canônicas distintas (não colapsam)", () => {
  // Regressão 2026-06-09: o alias "PMN" no MOBILIZA sobrescrevia a chave do PMN no
  // PARTY_INDEX e colapsava PMN -> MOBILIZA, reescrevendo histórico curado. PMN é
  // histórico, MOBILIZA é o rebrand de 2022; a curadoria usa AMBOS.
  assert.equal(resolveCanonicalParty("PMN")?.sigla, "PMN")
  assert.equal(resolveCanonicalParty("MOBILIZA")?.sigla, "MOBILIZA")
  assert.equal(canonicalPartiesEquivalent("PMN", "MOBILIZA"), false)
})

test("'Mobilizacao Nacional' resolve para PMN (espelha src/lib/party-utils)", () => {
  assert.equal(resolveCanonicalParty("Mobilizacao Nacional")?.sigla, "PMN")
  assert.equal(resolveCanonicalParty("Mobilização Nacional")?.sigla, "PMN")
  assert.equal(resolveCanonicalParty("Mobiliza")?.sigla, "MOBILIZA")
})

test("canonicalPartiesEquivalent trata AGIR como equivalente a Agir 36", () => {
  assert.equal(canonicalPartiesEquivalent("AGIR", "Agir 36"), true)
})
