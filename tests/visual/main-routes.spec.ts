import { test, expect } from "playwright/test"

const BASE_ORIGIN = new URL(process.env.PF_BASE_URL ?? "https://puxa-ficha.vercel.app").origin

function isIgnorableConsoleNoise(
  message: string,
  sawLocalInsightsFailure: boolean,
  sawExternalImageFailure: boolean,
): boolean {
  if (message.includes("/_vercel/insights/")) return true
  if (message.includes("[Vercel Web Analytics] Failed to load script")) return true
  return (
    (sawLocalInsightsFailure || sawExternalImageFailure) &&
    /Failed to load resource:.*status of (404|429)/i.test(message)
  )
}

function isExternalImageResponse(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.pathname === "/_next/image") {
      const original = parsed.searchParams.get("url")
      if (!original) return false
      return new URL(original).origin !== BASE_ORIGIN
    }
    return parsed.origin !== BASE_ORIGIN
  } catch {
    return false
  }
}

test.describe("Main routes visual verification", () => {
  const mainRoutes = [
    "/",
    "/candidato/lula",
    "/candidato/lula/timeline",
    "/doadores",
    "/quiz",
    "/comparar",
    "/rankings",
  ]

  mainRoutes.forEach((route) => {
    test(`route ${route} renders successfully`, async ({ page }) => {
      // Register listeners before goto to catch errors during page load
      const consoleErrors: string[] = []
      const httpErrors: string[] = []
      const imageErrors: string[] = []
      let sawLocalInsightsFailure = false

      page.on("response", (response) => {
        const url = response.url()
        const status = response.status()
        if (url.includes("/_vercel/insights/") && status >= 400) {
          sawLocalInsightsFailure = true
          return
        }
        if (status >= 400 && response.request().resourceType() === "image" && isExternalImageResponse(url)) {
          imageErrors.push(`${status} ${url}`)
          return
        }
        if (status >= 400) {
          httpErrors.push(`${status} ${url}`)
        }
      })

      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text())
        }
      })

      page.on("pageerror", (error) => {
        throw new Error(`Page error on ${route}: ${error.message}`)
      })

      const response = await page.goto(route)
      expect(response?.status()).toBe(200)

      const relevantConsoleErrors = consoleErrors.filter(
        (message) => !isIgnorableConsoleNoise(message, sawLocalInsightsFailure, imageErrors.length > 0),
      )

      if (httpErrors.length > 0) {
        throw new Error(`HTTP error on ${route}: ${httpErrors.join("; ")}`)
      }
      test.info().annotations.push({
        type: "external-image-errors",
        description: String(imageErrors.length),
      })

      // Fail if a product console error occurred. Local next start cannot serve
      // Vercel Analytics' /_vercel/insights/script.js; that noise is ignored
      // above and remains covered by production privacy/release checks.
      if (relevantConsoleErrors.length > 0) {
        throw new Error(`Console error on ${route}: ${relevantConsoleErrors.join("; ")}`)
      }

      // Page should have content
      const body = await page.textContent("body")
      expect(body?.length).toBeGreaterThan(100)

      // Page should have at least one heading
      const headings = await page.locator("h1, h2").count()
      expect(headings).toBeGreaterThan(0)
    })
  })
})
