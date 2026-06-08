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
        hubServerBin: "C:/AgentHub/dist/hub-server.exe",
        runtimeBin: "C:/AgentHub/dist/agent-runtime.exe",
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
      "C:/AgentHub/dist/hub-server.exe",
      "--port",
      "3456",
      "--hostname",
      "127.0.0.1",
      "--runtime-bin",
      "C:/AgentHub/dist/agent-runtime.exe",
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
        hubServerBin: "hub-server",
        runtimeBin: "agent-runtime",
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
