import { describe, expect, it } from "bun:test"
import { createRuntimeBuildCommand } from "./build"

describe("agent-runtime production build script", () => {
  it("externalizes worker and dynamic-path logger dependencies", () => {
    expect(createRuntimeBuildCommand()).toEqual([
      "bun",
      "build",
      "src/index.ts",
      "--target",
      "bun",
      "--outdir",
      "dist",
      "--external",
      "pino",
      "--external",
      "pino-pretty",
      "--external",
      "thread-stream",
      "--external",
      "sonic-boom",
    ])
  })
})
