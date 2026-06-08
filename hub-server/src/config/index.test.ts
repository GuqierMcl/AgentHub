import { describe, expect, it } from "bun:test"
import { parseHubConfig } from "./index"

describe("parseHubConfig", () => {
  it("parses production sidecar and static web flags", () => {
    const config = parseHubConfig([
      "--port",
      "3456",
      "--runtime-bin",
      "C:/AgentHub/agent-runtime.exe",
      "--public-dir",
      "C:/AgentHub/public",
      "--no-web",
    ], {})

    expect(config.port).toBe(3456)
    expect(config.runtimeBin).toBe("C:\\AgentHub\\agent-runtime.exe")
    expect(config.publicDir).toBe("C:\\AgentHub\\public")
    expect(config.noWeb).toBe(true)
  })

  it("keeps development mode on runtime-url when runtime-bin is absent", () => {
    const config = parseHubConfig([
      "--runtime-url",
      "http://127.0.0.1:4096",
    ], {})

    expect(config.runtimeBin).toBeUndefined()
    expect(config.runtimeUrl).toBe("http://127.0.0.1:4096")
    expect(config.noWeb).toBe(false)
  })

  it("parses bundle sidecar flags", () => {
    const config = parseHubConfig([
      "--bun-bin",
      "C:/AgentHub/bun.exe",
      "--runtime-entry",
      "C:/AgentHub/agent-runtime/index.js",
    ], {})

    expect(config.bunBin).toBe("C:\\AgentHub\\bun.exe")
    expect(config.runtimeEntry).toBe("C:\\AgentHub\\agent-runtime\\index.js")
  })
})
