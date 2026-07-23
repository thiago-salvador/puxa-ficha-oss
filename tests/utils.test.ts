import test from "node:test"
import assert from "node:assert/strict"
import {
  formatDate,
  getInitials,
  getWikimediaThumbnailUrl,
  safeHref,
  shouldBypassImageOptimization,
} from "../src/lib/utils"

test("safeHref accepts http and https URLs", () => {
  assert.equal(safeHref("https://puxaficha.com.br"), "https://puxaficha.com.br")
  assert.equal(safeHref("http://example.com"), "http://example.com")
})

test("safeHref rejects unsafe protocols", () => {
  assert.equal(safeHref("javascript:alert(1)"), null)
  assert.equal(safeHref("data:text/html;base64,AAAA"), null)
})

test("formatDate preserves bare ISO dates without timezone drift", () => {
  assert.equal(formatDate("2016-09-14"), "14/09/2016")
})

test("formatDate normalizes timestamps to the public Brazil timezone", () => {
  assert.equal(formatDate("2026-04-09T02:00:00+00:00"), "08/04/2026")
})

test("formatDate returns a stable fallback for invalid dates", () => {
  assert.equal(formatDate("not-a-date"), "Data indisponível")
  assert.equal(formatDate("2026-13-45"), "Data indisponível")
  assert.equal(formatDate(new Date(Number.NaN)), "Data indisponível")
})

test("getInitials ignores repeated whitespace and empty names", () => {
  assert.equal(getInitials("  Maria   Silva  "), "MS")
  assert.equal(getInitials("Lula "), "LU")
  assert.equal(getInitials("   "), "")
})

test("shouldBypassImageOptimization optimizes allowlisted remote images", () => {
  assert.equal(
    shouldBypassImageOptimization("https://upload.wikimedia.org/wikipedia/commons/thumb/a/photo.jpg"),
    false,
  )
  assert.equal(
    shouldBypassImageOptimization("https://www.camara.leg.br/internet/deputado/foto.jpg"),
    false,
  )
})

test("shouldBypassImageOptimization returns true for unknown hosts", () => {
  assert.equal(
    shouldBypassImageOptimization("https://random-unknown-host.example.com/photo.jpg"),
    true,
  )
})

test("shouldBypassImageOptimization lets Next resize full Wikimedia originals", () => {
  assert.equal(
    shouldBypassImageOptimization("https://upload.wikimedia.org/wikipedia/commons/3/34/photo.png"),
    false,
  )
})

test("shouldBypassImageOptimization returns false for relative URLs", () => {
  assert.equal(shouldBypassImageOptimization("/images/hero.jpg"), false)
  assert.equal(shouldBypassImageOptimization("images/photo.png"), false)
})

test("shouldBypassImageOptimization returns false for null/undefined", () => {
  assert.equal(shouldBypassImageOptimization(null), false)
  assert.equal(shouldBypassImageOptimization(undefined), false)
})

test("getWikimediaThumbnailUrl downscales Wikimedia thumb URLs", () => {
  assert.equal(
    getWikimediaThumbnailUrl(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/photo.jpg/960px-photo.jpg",
      315,
    ),
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/photo.jpg/330px-photo.jpg",
  )
})

test("getWikimediaThumbnailUrl leaves non-thumb URLs unchanged", () => {
  assert.equal(
    getWikimediaThumbnailUrl("https://upload.wikimedia.org/wikipedia/commons/9/9e/photo.jpg", 315),
    "https://upload.wikimedia.org/wikipedia/commons/9/9e/photo.jpg",
  )
})
