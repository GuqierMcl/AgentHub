import { describe, expect, it } from "bun:test"
import { parseCliConfig } from "./config"

describe("parseCliConfig", () => {
  it("parses explicit CLI options", () => {
    const config = parseCliConfig([
      "--port",
      "3456",
      "--data-dir",
      "C:/AgentHub/data",
      "--log-level",
      "debug",
      "--no-browser",
    ])

    expect(config).toEqual({
      port: 3456,
      dataDir: "C:/AgentHub/data",
      logLevel: "debug",
      noBrowser: true,
    })
  })

  it("supports short aliases", () => {
    const config = parseCliConfig([
      "-p",
      "3456",
      "-d",
      "C:/AgentHub/data",
      "-l",
      "info",
    ])

    expect(config.port).toBe(3456)
    expect(config.dataDir).toBe("C:/AgentHub/data")
    expect(config.logLevel).toBe("info")
    expect(config.noBrowser).toBe(false)
  })

  it("leaves the port undefined when automatic probing should be used", () => {
    const config = parseCliConfig([])

    expect(config.port).toBeUndefined()
    expect(config.noBrowser).toBe(false)
  })

  it("rejects invalid ports", () => {
    expect(() => parseCliConfig(["--port", "70000"])).toThrow("Invalid --port")
    expect(() => parseCliConfig(["--port", "0"])).toThrow("Invalid --port")
  })
})
