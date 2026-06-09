import { describe, expect, test } from "bun:test"

import type { DeploymentSnapshot } from "../types"
import { getDeploymentSshStatusBarItem } from "./deployment-ssh-status"

describe("deployment SSH status bar item", () => {
  test("maps a connected deployment SSH session to a composer status item", () => {
    expect(
      getDeploymentSshStatusBarItem(snapshot("connected", "公司服务器"))
    ).toEqual({
      id: "deployment-ssh:dep_1",
      label: "SSH",
      status: "connected",
      statusLabel: "已连接：公司服务器",
      tone: "success",
      description: "prod.example.com",
    })
  })

  test("maps a connecting deployment SSH session to a warning status item", () => {
    expect(
      getDeploymentSshStatusBarItem(snapshot("connecting", "公司服务器"))
    ).toMatchObject({
      label: "SSH",
      status: "connecting",
      statusLabel: "连接中：公司服务器",
      tone: "warning",
    })
  })

  test("hides stale or disconnected deployment SSH sessions", () => {
    expect(getDeploymentSshStatusBarItem(snapshot("stale", "公司服务器"))).toBeNull()
    expect(getDeploymentSshStatusBarItem(snapshot("disconnected", "公司服务器"))).toBeNull()
    expect(getDeploymentSshStatusBarItem(null)).toBeNull()
  })
})

function snapshot(
  connectionStatus: DeploymentSnapshot["connectionStatus"],
  displayName: string
): DeploymentSnapshot {
  return {
    version: 1,
    deploymentId: "dep_1",
    conversationId: "conv_1",
    status: "running",
    server: {
      id: "server_1",
      displayName,
      hostLabel: "prod.example.com",
    },
    connectionStatus,
    commands: [],
    logs: [],
    updatedAt: "2026-06-09T00:00:00.000Z",
  }
}
