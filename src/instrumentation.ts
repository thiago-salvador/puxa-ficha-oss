export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config")
    const { validateProductionEnvironment } = await import("@/lib/production-env")
    validateProductionEnvironment()
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config")
  }
}
