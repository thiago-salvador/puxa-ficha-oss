import { readFileSync } from "node:fs"

export function readJsonFixture<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T
}

export function countBy<T>(values: T[], keyFn: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = keyFn(value)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

export function countValues<T extends string>(values: T[]): Record<string, number> {
  return countBy(values, (value) => value)
}
