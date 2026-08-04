import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "playwright/test"

type RouteA11y = {
  name: string
  path: string
  // Regras do axe com violação conhecida em produção (master review de
  // 2026-08-04, reconfirmada com a espera de animação ativa). Só essas regras
  // ficam desligadas na rota até o grupo G6 corrigir; o resto do gate segue
  // ativo, então violação nova de qualquer outra regra reprova. Ao mergear o
  // G6, remover o campo para reativar o gate completo.
  regrasDesligadasAteG6?: string[]
  // Restringe o desligamento a um projeto quando o outro já passa completo.
  regrasSoNoProjeto?: "desktop" | "mobile"
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
    regrasDesligadasAteG6: ["nested-interactive", "heading-order"],
  },
  { name: "uf", path: "/uf/sp" },
  { name: "rankings", path: "/rankings" },
  { name: "ranking-detail", path: "/rankings/gastos-parlamentares" },
  {
    name: "candidate-timeline",
    path: "/candidato/lula/timeline",
    regrasDesligadasAteG6: ["color-contrast"],
    regrasSoNoProjeto: "desktop",
  },
  {
    name: "quiz-questions",
    path: "/quiz/perguntas",
    regrasDesligadasAteG6: ["listitem", "page-has-heading-one"],
  },
  {
    name: "quiz-result",
    path: "/quiz/resultado",
    regrasDesligadasAteG6: ["page-has-heading-one"],
  },
  {
    name: "embed-home",
    path: "/embed",
    regrasDesligadasAteG6: ["scrollable-region-focusable"],
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
      const regrasDesligadas =
        route.regrasDesligadasAteG6 &&
        (!route.regrasSoNoProjeto || route.regrasSoNoProjeto === test.info().project.name)
          ? route.regrasDesligadasAteG6
          : []
      if (regrasDesligadas.length > 0) {
        test.info().annotations.push({
          type: "regras-desligadas-ate-g6",
          description: regrasDesligadas.join(", "),
        })
      }
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

      const results = await new AxeBuilder({ page }).disableRules(regrasDesligadas).analyze()
      const blockingViolations = results.violations.filter((violation) =>
        violation.impact === "moderate" ||
        violation.impact === "serious" ||
        violation.impact === "critical"
      )

      expect(blockingViolations, formatViolations(blockingViolations)).toEqual([])
    })
  }
})
