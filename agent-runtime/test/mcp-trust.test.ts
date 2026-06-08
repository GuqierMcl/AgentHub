import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  McpTrustService,
  type McpTrustWorkspace,
} from "../src/runtime"

async function createService(): Promise<{
  service: McpTrustService
  dataDir: string
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-mcp-trust-"))
  const service = new McpTrustService({ dataDir })
  await service.initialize()
  return { service, dataDir }
}

const workspace: McpTrustWorkspace = {
  workspaceId: "workspace_alpha",
  backendType: "local",
  rootPath: "D:\\Projects\\Alpha",
}

describe("McpTrustService", () => {
  test("returns default trusted global records", async () => {
    const { service } = await createService()

    const result = await service.list({
      scope: "global",
      mcpRefs: ["global:codex:config.toml:filesystem"],
    })

    expect(result.scope).toBe("global")
    expect(result.workspace).toBeUndefined()
    expect(result.trusts).toHaveLength(1)
    expect(result.trusts[0]).toMatchObject({
      scope: "global",
      level: "global",
      mcpRef: "global:codex:config.toml:filesystem",
      trusted: true,
      status: "trusted",
    })
    expect(result.trusts[0].trustedAt).toBeUndefined()
    expect(await service.isTrusted({
      scope: "global",
      mcpRef: "global:codex:config.toml:filesystem",
    })).toBe(true)
  })

  test("persists trusted and revoked workspace MCP decisions without exposing root paths", async () => {
    const { service, dataDir } = await createService()

    const trusted = await service.decide({
      scope: "workspace",
      workspace,
      mcpRef: "workspace:agents:mcp.json:filesystem",
      trusted: true,
      reason: "user-approved",
    })

    expect(trusted.record).toMatchObject({
      scope: "workspace",
      level: "workspace",
      workspaceId: "workspace_alpha",
      backendType: "local",
      workspaceRootHash: expect.any(String),
      mcpRef: "workspace:agents:mcp.json:filesystem",
      trusted: true,
      status: "trusted",
    })
    expect(JSON.stringify(trusted)).not.toContain("D:\\Projects\\Alpha")
    expect(await service.isTrusted({
      scope: "workspace",
      workspace,
      mcpRef: "workspace:agents:mcp.json:filesystem",
    })).toBe(true)

    const reloaded = new McpTrustService({ dataDir })
    await reloaded.initialize()
    const revoked = await reloaded.decide({
      scope: "workspace",
      workspace,
      mcpRef: "workspace:agents:mcp.json:filesystem",
      trusted: false,
      reason: "user-revoked",
    })

    expect(revoked.record).toMatchObject({
      trusted: false,
      status: "untrusted",
    })
    expect(revoked.record.revokedAt).toBeDefined()
    expect(await reloaded.isTrusted({
      scope: "workspace",
      workspace,
      mcpRef: "workspace:agents:mcp.json:filesystem",
    })).toBe(false)

    const raw = await readFile(join(dataDir, "mcp-trust.json"), "utf-8")
    expect(raw).not.toContain("D:\\Projects\\Alpha")
    expect(raw).not.toContain("token")
    expect(raw).not.toContain("secret")
  })

  test("keeps global and workspace trust decisions independent", async () => {
    const { service } = await createService()
    const mcpRef = "global:codex:config.toml:filesystem"

    await service.decide({
      scope: "global",
      mcpRef,
      trusted: false,
    })

    expect(await service.isTrusted({
      scope: "global",
      mcpRef,
    })).toBe(false)
    expect(await service.isTrusted({
      scope: "workspace",
      workspace,
      mcpRef,
    })).toBe(true)
  })

  test("scopes workspace revokes to the workspace root hash", async () => {
    const { service } = await createService()

    await service.decide({
      scope: "workspace",
      workspace,
      mcpRef: "workspace:agents:mcp.json:filesystem",
      trusted: false,
    })

    expect(await service.isTrusted({
      scope: "workspace",
      workspace,
      mcpRef: "workspace:agents:mcp.json:filesystem",
    })).toBe(false)
    expect(await service.isTrusted({
      scope: "workspace",
      workspace: {
        ...workspace,
        rootPath: "D:\\Projects\\Different",
      },
      mcpRef: "workspace:agents:mcp.json:filesystem",
    })).toBe(true)
  })

  test("rejects workspace scope without workspace and malformed MCP refs", async () => {
    const { service } = await createService()

    await expect(service.list({
      scope: "workspace",
      mcpRefs: ["workspace:agents:mcp.json:filesystem"],
    })).rejects.toMatchObject({
      code: "MCP_TRUST_WORKSPACE_REQUIRED",
    })

    await expect(service.decide({
      scope: "global",
      mcpRef: "global codex config",
      trusted: true,
    })).rejects.toMatchObject({
      code: "MCP_TRUST_REF_INVALID",
    })
  })

  test("reports store failures through redacted MCP runtime status", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-mcp-trust-store-failure-"))
    const service = new McpTrustService({ dataDir, filePath: dataDir })
    await service.initialize()

    await expect(service.decide({
      scope: "global",
      mcpRef: "global:codex:config.toml:filesystem",
      trusted: false,
    })).rejects.toMatchObject({
      code: "MCP_TRUST_STORE_FAILED",
    })

    const status = service.getStatus()
    expect(status).toMatchObject({
      status: "error",
      details: expect.objectContaining({
        trustedRecordCount: 1,
        latestError: expect.any(String),
      }),
    })
    expect(JSON.stringify(status)).not.toContain(dataDir)
  })
})
