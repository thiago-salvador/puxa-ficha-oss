import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "playwright/test"

const ROUTES = [
  { name: "home", path: "/" },
  { name: "candidate", path: "/candidato/lula" },
  { name: "compare", path: "/comparar" },
  { name: "donors", path: "/doadores?q=silva" },
  { name: "quiz", path: "/quiz" },
  { name: "alerts-access", path: "/alertas/acesso" },
]

function formatViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")
      return `${violation.id} (${violation.impact}): ${violation.help} [${targets}]`
    })
    .join("\n")
}

test.describe("Acessibilidade automatizada", () => {
  for (const route of ROUTES) {
    test(`${route.name} has no moderate, serious or critical axe violations`, async ({ page }) => {
      const path =
        route.name === "alerts-access" && test.info().project.name === "mobile"
          ? "/alertas/gerenciar"
          : route.path
      await page.goto(path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => undefined)

      const results = await new AxeBuilder({ page }).analyze()
      const blockingViolations = results.violations.filter((violation) =>
        violation.impact === "moderate" ||
        violation.impact === "serious" ||
        violation.impact === "critical"
      )

      expect(blockingViolations, formatViolations(blockingViolations)).toEqual([])
    })
  }
})
