import { describe, expect, test } from "bun:test"
import { getWorkspaceMcpStatusBarItems } from "./workspace-mcp-status"
import type { WorkspaceMcpStatusResponse } from "../api/workspace-mcp-status"

function statusFixture(): WorkspaceMcpStatusResponse {
  return {
    checkedAt: "2026-06-08T00:00:00.000Z",
    workspace: {
      workspaceId: "workspace_1",
      backendType: "local",
      workspaceRootHash: "hash",
    },
    summary: {
      serverCount: 2,
      enabledCount: 2,
      connectedCount: 1,
      errorCount: 1,
      toolCount: 2,
    },
    servers: [
      {
        id: "workspace:opencode:opencode.json:docs",
        name: "docs",
        source: "opencode",
        transport: "stdio",
        status: "connected",
        enabled: true,
        trusted: true,
        toolCount: 2,
      },
      {
        id: "workspace:agents:mcp.json:broken",
        name: "broken",
        source: "agents",
        transport: "stdio",
        status: "error",
        enabled: true,
        trusted: true,
        toolCount: 0,
        latestError: "connect failed",
      },
    ],
  }
}

describe("workspace MCP status bar items", () => {
  test("maps connected and error MCP servers to compact pill metadata", () => {
    const items = getWorkspaceMcpStatusBarItems(statusFixture())

    expect(items).toEqual([
      {
        id: "mcp:workspace:opencode:opencode.json:docs",
        label: "docs",
        status: "connected",
        statusLabel: "已连接 · 2 个工具",
        tone: "success",
      },
      {
        id: "mcp:workspace:agents:mcp.json:broken",
        label: "broken",
        status: "error",
        statusLabel: "错误 · 0 个工具",
        tone: "danger",
        description: "connect failed",
      },
    ])
  })

  test("returns no items when the workspace has no MCP servers", () => {
    expect(getWorkspaceMcpStatusBarItems({
      ...statusFixture(),
      servers: [],
    })).toEqual([])
  })
})
