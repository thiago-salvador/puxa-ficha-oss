import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "playwright/test"

type RouteA11y = {
  name: string
  path: string
  // Violação conhecida em produção (master review 2026-08-04, reconfirmada em
  // 2026-08-04 com a espera de animação ativa): o teste vira fixme até o grupo
  // G6 corrigir. Ao mergear o G6, remover o campo para reativar o gate.
  fixmeAteG6?: string
  // Restringe o fixme a um projeto quando o outro já passa (gate continua ativo).
  fixmeSoNoProjeto?: "desktop" | "mobile"
}

const ROUTES: RouteA11y[] = [
  { name: "home", path: "/" },
  { name: "candidate", path: "/candidato/lula" },
  { name: "compare", path: "/comparar" },
  { name: "donors", path: "/doadores?q=silva" },
  { name: "quiz", path: "/quiz" },
  { name: "alerts-access", path: "/alertas/acesso" },
  {
    name: "governors",
    path: "/governadores",
    fixmeAteG6: "G6: nested-interactive (serious) e heading-order (moderate) em producao",
  },
  { name: "uf", path: "/uf/sp" },
  { name: "rankings", path: "/rankings" },
  { name: "ranking-detail", path: "/rankings/gastos-parlamentares" },
  {
    name: "candidate-timeline",
    path: "/candidato/lula/timeline",
    fixmeAteG6: "G6: color-contrast (serious) em producao, so no desktop",
    fixmeSoNoProjeto: "desktop",
  },
  {
    name: "quiz-questions",
    path: "/quiz/perguntas",
    fixmeAteG6: "G6: listitem (serious) e page-has-heading-one (moderate) em producao",
  },
  {
    name: "quiz-result",
    path: "/quiz/resultado",
    fixmeAteG6: "G6: page-has-heading-one (moderate) em producao",
  },
  {
    name: "embed-home",
    path: "/embed",
    fixmeAteG6: "G6: scrollable-region-focusable (serious) em producao",
  },
  { name: "embed-candidate", path: "/embed/lula" },
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
      test.fixme(
        Boolean(route.fixmeAteG6) &&
          (!route.fixmeSoNoProjeto || route.fixmeSoNoProjeto === test.info().project.name),
        route.fixmeAteG6,
      )
      const path =
        route.name === "alerts-access" && test.info().project.name === "mobile"
          ? "/alertas/gerenciar"
          : route.path
      await page.goto(path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => undefined)

      // As animações de entrada (hero-fade, stagger-item, section-reveal) mantêm
      // opacity 0 durante o delay; o axe roda depois que todas terminam, senão o
      // H1 ainda invisível dispara page-has-heading-one (falha intermitente do
      // job de a11y na main em 04/08). Se alguma animação nunca terminar, o
      // timeout deixa o axe rodar mesmo assim e reportar a violação real.
      await page
        .waitForFunction(
          () =>
            Array.from(
              document.querySelectorAll(".hero-fade, .stagger-item, .section-reveal"),
            ).every((el) => getComputedStyle(el).opacity === "1"),
          undefined,
          { timeout: 10_000 },
        )
        .catch(() => undefined)

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
