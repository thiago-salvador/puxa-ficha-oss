/**
 * Contrato TS ↔ SQL: `public.is_public_attention_point` (migration 20260403234500).
 * Falhas aqui indicam divergência entre RLS/views no Postgres e filtros em `api.ts`.
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isPublicAttentionPointFields } from "../src/lib/public-attention-point"

describe("Supabase contract: is_public_attention_point (TS mirror of SQL)", () => {
  it("visivel false ou null: nunca público", () => {
    assert.equal(isPublicAttentionPointFields(false, "curadoria", true), false)
    assert.equal(isPublicAttentionPointFields(null, "curadoria", true), false)
    assert.equal(isPublicAttentionPointFields(undefined, "ia", true), false)
  })

  it("visivel true e não-IA: público mesmo sem verificado", () => {
    assert.equal(isPublicAttentionPointFields(true, "curadoria", false), true)
    assert.equal(isPublicAttentionPointFields(true, null, false), true)
    assert.equal(isPublicAttentionPointFields(true, "automatico", null), true)
  })

  it("visivel true e IA: só público se verificado === true", () => {
    assert.equal(isPublicAttentionPointFields(true, "ia", true), true)
    assert.equal(isPublicAttentionPointFields(true, "ia", false), false)
    assert.equal(isPublicAttentionPointFields(true, "ia", null), false)
    assert.equal(isPublicAttentionPointFields(true, "ia", undefined), false)
  })
})
