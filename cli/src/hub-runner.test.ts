import { describe, expect, it } from "bun:test"
import {
  shutdownHubServer,
  startHubServer,
  type HubServerProcess,
} from "./hub-runner"

function neverExitProcess(kills: string[]): HubServerProcess {
  return {
    exited: new Promise<number>(() => {}),
    kill: (signal?: NodeJS.Signals) => {
      kills.push(signal ?? "SIGTERM")
    },
  }
}

function exitedProcess(kills: string[], code = 0): HubServerProcess {
  return {
    exited: Promise.resolve(code),
    kill: (signal?: NodeJS.Signals) => {
      kills.push(signal ?? "SIGTERM")
    },
  }
}

describe("startHubServer", () => {
  it("spawns HubServer with sidecar and public-dir production arguments", async () => {
    const commands: string[][] = []
    const kills: string[] = []
    const running = await startHubServer({
      port: 3456,
      paths: {
        bunBin: "C:/AgentHub/dist/bun.exe",
        hubServerEntry: "C:/AgentHub/dist/hub-server/index.js",
        hubServerNodeModulesDir: "C:/AgentHub/dist/hub-server/node_modules",
        runtimeEntry: "C:/AgentHub/dist/agent-runtime/index.js",
        runtimeNodeModulesDir: "C:/AgentHub/dist/agent-runtime/node_modules",
        publicDir: "C:/AgentHub/dist/public",
      },
      dataDir: "C:/AgentHub/data",
      logLevel: "debug",
      spawn: (command) => {
        commands.push(command)
        return neverExitProcess(kills)
      },
      fetchHealth: async () => true,
      sleep: async () => {},
    })

    expect(running.url).toBe("http://127.0.0.1:3456")
    expect(commands[0]).toEqual([
      "C:/AgentHub/dist/bun.exe",
      "C:/AgentHub/dist/hub-server/index.js",
      "--port",
      "3456",
      "--hostname",
      "127.0.0.1",
      "--bun-bin",
      "C:/AgentHub/dist/bun.exe",
      "--runtime-entry",
      "C:/AgentHub/dist/agent-runtime/index.js",
      "--public-dir",
      "C:/AgentHub/dist/public",
      "--data-dir",
      "C:/AgentHub/data",
      "--log-level",
      "debug",
    ])
  })

  it("kills HubServer when health polling times out", async () => {
    const kills: string[] = []

    await expect(startHubServer({
      port: 3456,
      paths: {
        bunBin: "bun",
        hubServerEntry: "hub-server/index.js",
        hubServerNodeModulesDir: "hub-server/node_modules",
        runtimeEntry: "agent-runtime/index.js",
        runtimeNodeModulesDir: "agent-runtime/node_modules",
        publicDir: "public",
      },
      spawn: () => neverExitProcess(kills),
      fetchHealth: async () => false,
      sleep: async () => {},
      readyTimeoutMs: 1,
    })).rejects.toThrow("HubServer did not become ready")

    expect(kills).toEqual(["SIGTERM"])
  })

  it("forwards shutdown signals to HubServer", async () => {
    const kills: string[] = []
    const process = exitedProcess(kills)

    await shutdownHubServer(process, "SIGINT", async () => {})

    expect(kills).toEqual(["SIGINT"])
  })
})
