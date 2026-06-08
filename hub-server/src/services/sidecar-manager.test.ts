import { describe, expect, it } from "bun:test"
import { SidecarManager } from "./sidecar-manager"

describe("SidecarManager", () => {
  it("spawns Runtime with the production sidecar arguments and token env", async () => {
    const spawns: Array<{ command: string[], env?: Record<string, string> }> = []
    const manager = new SidecarManager({
      allocatePort: async () => 4567,
      fetchHealth: async () => ({ status: "ok" }),
      sleep: async () => {},
      spawn: (command, options) => {
        spawns.push({ command, env: options.env })
        return {
          exited: new Promise<number>(() => {}),
          kill: () => {},
        }
      },
    })

    const endpoint = await manager.start({
      runtimeBin: "agent-runtime.exe",
      hubUrl: "http://127.0.0.1:3000",
      dataDir: "C:/AgentHub/runtime-data",
      workdir: "C:/AgentHub/runtime-work",
      logLevel: "info",
      token: "secret",
    })

    expect(endpoint).toEqual({
      port: 4567,
      url: "http://127.0.0.1:4567",
    })
    expect(spawns[0].command).toEqual([
      "agent-runtime.exe",
      "--port",
      "4567",
      "--hostname",
      "127.0.0.1",
      "--hub-callback",
      "http://127.0.0.1:3000",
      "--data-dir",
      "C:/AgentHub/runtime-data",
      "--workdir",
      "C:/AgentHub/runtime-work",
      "--log-level",
      "info",
    ])
    expect(spawns[0].env).toMatchObject({
      AGENTHUB_RUNTIME_TOKEN: "secret",
    })
  })

  it("spawns Runtime bundle through the packaged Bun runtime", async () => {
    const spawns: Array<{ command: string[], env?: Record<string, string> }> = []
    const manager = new SidecarManager({
      allocatePort: async () => 4096,
      fetchHealth: async () => ({ status: "ok" }),
      sleep: async () => {},
      spawn: (command, options) => {
        spawns.push({ command, env: options.env })
        return {
          exited: new Promise<number>(() => {}),
          kill: () => {},
        }
      },
    })

    const endpoint = await manager.start({
      bunBin: "C:/AgentHub/bun.exe",
      runtimeEntry: "C:/AgentHub/agent-runtime/index.js",
      hubUrl: "http://127.0.0.1:3456",
      dataDir: "C:/AgentHub/runtime-data",
      workdir: "C:/AgentHub/runtime-work",
      logLevel: "info",
      token: "secret",
    })

    expect(endpoint).toEqual({
      port: 4096,
      url: "http://127.0.0.1:4096",
    })
    expect(spawns[0].command).toEqual([
      "C:/AgentHub/bun.exe",
      "C:/AgentHub/agent-runtime/index.js",
      "--port",
      "4096",
      "--hostname",
      "127.0.0.1",
      "--hub-callback",
      "http://127.0.0.1:3456",
      "--data-dir",
      "C:/AgentHub/runtime-data",
      "--workdir",
      "C:/AgentHub/runtime-work",
      "--log-level",
      "info",
    ])
    expect(spawns[0].env).toMatchObject({
      AGENTHUB_RUNTIME_TOKEN: "secret",
    })
  })

  it("stops restarting after three unexpected exits", async () => {
    let spawnCount = 0
    const manager = new SidecarManager({
      allocatePort: async () => 4600 + spawnCount,
      fetchHealth: async () => ({ status: "ok" }),
      sleep: async () => {},
      spawn: () => {
        spawnCount += 1
        return {
          exited: Promise.resolve(1),
          kill: () => {},
        }
      },
    })

    await manager.start({
      runtimeBin: "agent-runtime.exe",
      hubUrl: "http://127.0.0.1:3000",
      dataDir: "C:/AgentHub/runtime-data",
      workdir: "C:/AgentHub/runtime-work",
      logLevel: "info",
      token: "secret",
    })
    await Bun.sleep(10)

    expect(spawnCount).toBe(4)
    expect(manager.getEndpoint()).toBeNull()
  })
})
