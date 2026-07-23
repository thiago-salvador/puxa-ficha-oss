#!/usr/bin/env node

import Module from "node:module"
import path from "node:path"

const originalLoad = Module._load

Module._load = function loadWithYargsCompat(request, parent, ...rest) {
  if (request === "yargs/yargs") {
    const yargsBuildPath = path.join(process.cwd(), "node_modules", "yargs", "build", "index.cjs")
    const { applyExtends, cjsPlatformShim, Parser, Yargs, processArgv } = originalLoad.call(
      this,
      yargsBuildPath,
      parent,
      false
    )

    Yargs.applyExtends = (config, cwd, mergeExtends) => {
      return applyExtends(config, cwd, mergeExtends, cjsPlatformShim)
    }
    Yargs.hideBin = processArgv.hideBin
    Yargs.Parser = Parser
    return Yargs
  }

  return originalLoad.call(this, request, parent, ...rest)
}

await import("../node_modules/c8/bin/c8.js")
