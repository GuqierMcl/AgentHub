import { EventEmitter } from "node:events"
import { describe, expect, mock, test } from "bun:test"
import { SshDeploymentConnectionManager } from "./ssh-connection-manager"
import type { RunEvent } from "../types"

let latestClient: FakeSshClient | null = null

class FakeSshClient extends EventEmitter {
  connect(): void {
    queueMicrotask(() => {
      this.emit("error", new Error("All configured authentication methods failed"))
    })
  }

  exec(): void {}
  sftp(): void {}
  end(): void {}
  destroy(): void {}
}

mock.module("ssh2", () => ({
  Client: class extends FakeSshClient {
    constructor() {
      super()
      latestClient = this
    }
  },
}))

describe("SshDeploymentConnectionManager", () => {
  test("contains SSH authentication failures and later client errors", async () => {
    const manager = new SshDeploymentConnectionManager()
    const events: RunEvent[] = []

    await expect(manager.connect({
      runId: "run_ssh_auth",
      conversationId: "conv_ssh_auth",
      deploymentId: "dep_ssh_auth",
      agentId: "deploy",
      toolCallId: "tool_connect",
      toolName: "connect_deploy_server",
      emitEvent: (event) => events.push(event),
      material: {
        id: "srv_1",
        displayName: "Production",
        hostLabel: "prod.example.com",
        host: "prod.example.com",
        port: 22,
        username: "deploy",
        user: "deploy",
        password: "bad-password",
        readyTimeoutMs: 100,
      },
    })).rejects.toThrow("All configured authentication methods failed")

    expect(events.map((event) => event.type)).toEqual([
      "deployment.connection.changed",
      "deployment.connection.changed",
    ])
    expect(events.at(-1)?.data).toMatchObject({
      deploymentId: "dep_ssh_auth",
      conversationId: "conv_ssh_auth",
      connectionStatus: "failed",
      reason: "All configured authentication methods failed",
    })
    expect(() => {
      latestClient?.emit("error", new Error("late ssh2 auth cleanup error"))
    }).not.toThrow()
  })
})
