/**
 * Minimal PostgREST mock server for integration tests.
 * Serves fixture rows on GET and records PATCH writes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

export interface PatchRequest {
  table: string
  filterField: string
  filterValue: string
  body: Record<string, unknown>
}

export interface PostgRESTMock {
  url: string
  port: number
  patches: PatchRequest[]
  close: () => Promise<void>
}

export async function startPostgRESTMock(
  fixturesByTable: Record<string, unknown[]>,
  options?: { debug?: boolean }
): Promise<PostgRESTMock> {
  const patches: PatchRequest[] = []
  const debug = options?.debug ?? false

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost`)
    const pathParts = url.pathname.split("/").filter(Boolean)
    // PostgREST paths: /rest/v1/{table}
    const table = pathParts[pathParts.length - 1] ?? ""

    if (debug) console.log(`[postgrest-mock] ${req.method} ${req.url} -> table=${table}`)

    res.setHeader("Content-Type", "application/json")

    if (req.method === "GET") {
      const rows = fixturesByTable[table] ?? []
      // Apply PostgREST-style filters from query params
      let filtered = [...rows] as Record<string, unknown>[]
      for (const [key, value] of url.searchParams.entries()) {
        if (key === "select" || key === "order") continue
        if (value.startsWith("eq.")) {
          const eqVal = value.slice(3)
          filtered = filtered.filter((r) => String(r[key]) === eqVal)
        }
        if (value.startsWith("not.is.null")) {
          filtered = filtered.filter((r) => r[key] !== null && r[key] !== undefined)
        }
      }
      // Apply ordering
      const order = url.searchParams.get("order")
      if (order) {
        const [field, dir] = order.split(".")
        filtered.sort((a, b) => {
          const av = a[field] as number, bv = b[field] as number
          return dir === "desc" ? bv - av : av - bv
        })
      }
      res.writeHead(200)
      res.end(JSON.stringify(filtered))
      return
    }

    if (req.method === "PATCH") {
      const bodyChunks: Buffer[] = []
      for await (const chunk of req) bodyChunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(bodyChunks).toString("utf-8"))

      // Extract filter from query params (e.g., id=eq.hp-1)
      let filterField = ""
      let filterValue = ""
      for (const [key, value] of url.searchParams.entries()) {
        if (value.startsWith("eq.")) {
          filterField = key
          filterValue = value.slice(3)
          break
        }
      }

      patches.push({ table, filterField, filterValue, body })

      // Apply to in-memory fixture
      const rows = fixturesByTable[table] as Record<string, unknown>[] | undefined
      if (rows) {
        const target = rows.find((r) => String(r[filterField]) === filterValue)
        if (target) Object.assign(target, body)
      }

      res.writeHead(200)
      res.end(JSON.stringify([]))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ message: "not found" }))
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        patches,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}
