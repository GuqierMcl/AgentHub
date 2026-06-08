import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"
import {
  CapabilityDiscoveryService,
} from "../src/runtime/capabilities"
import { capabilitiesRouter } from "../src/routers/capabilities"

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, content, "utf-8")
}

function createApp(service: CapabilityDiscoveryService): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("capabilityDiscoveryService", service)
    await next()
  })
  app.route("/", capabilitiesRouter)
  return app
}

describe("capability discovery", () => {
  test("discovers global and workspace skills without exposing absolute paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    const workspaceRoot = join(root, "workspace")

    await writeText(
      join(homeDir, ".agents", "skills", "global-skill", "SKILL.md"),
      [
        "---",
        "name: Global Skill",
        "description: Available everywhere",
        "---",
        "",
        "# Body omitted",
      ].join("\n"),
    )
    await writeText(
      join(workspaceRoot, ".codex", "skills", "workspace-skill", "SKILL.md"),
      [
        "---",
        "name: Workspace Skill",
        "description: Project only",
        "---",
        "",
        "# Body omitted",
      ].join("\n"),
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir })
    const result = await service.discover({
      scope: "all",
      workspace: {
        workspaceId: "workspace_test",
        backendType: "local",
        rootPath: workspaceRoot,
      },
    })

    expect(result.skills).toContainEqual(expect.objectContaining({
      name: "Global Skill",
      source: "agents",
      level: "global",
      valid: true,
    }))
    expect(result.skills).toContainEqual(expect.objectContaining({
      name: "Workspace Skill",
      source: "codex",
      level: "workspace",
      valid: true,
    }))
    expect(JSON.stringify(result)).not.toContain(homeDir)
    expect(JSON.stringify(result)).not.toContain(workspaceRoot)
  })

  test("reports invalid skill frontmatter as a warning instead of failing discovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-invalid-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")

    await writeText(
      join(homeDir, ".claude", "skills", "bad-skill", "SKILL.md"),
      ["---", "name: [unterminated", "---", "# Broken"].join("\n"),
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir })
    const result = await service.discover({ scope: "global" })

    expect(result.skills).toContainEqual(expect.objectContaining({
      name: "bad-skill",
      source: "claude-code",
      valid: false,
    }))
    expect(result.skills.find((skill) => skill.name === "bad-skill")?.warnings.length).toBeGreaterThan(0)
  })

  test("discovers skills across global and workspace source families", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-skill-matrix-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    const workspaceRoot = join(root, "workspace")

    await writeText(join(homeDir, ".agents", "skills", "agents-global", "SKILL.md"), "---\nname: Agents Global\n---")
    await writeText(join(homeDir, ".codex", "skills", "codex-global", "SKILL.md"), "---\nname: Codex Global\n---")
    await writeText(join(homeDir, ".claude", "skills", "claude-global", "SKILL.md"), "---\nname: Claude Global\n---")
    await writeText(
      join(homeDir, ".config", "opencode", "skills", "opencode-global", "SKILL.md"),
      "---\nname: OpenCode Global\n---",
    )
    await writeText(
      join(workspaceRoot, ".agents", "skills", "agents-workspace", "SKILL.md"),
      "---\nname: Agents Workspace\n---",
    )
    await writeText(
      join(workspaceRoot, ".codex", "skills", "codex-workspace", "SKILL.md"),
      "---\nname: Codex Workspace\n---",
    )
    await writeText(
      join(workspaceRoot, ".claude", "skills", "claude-workspace", "SKILL.md"),
      "---\nname: Claude Workspace\n---",
    )
    await writeText(
      join(workspaceRoot, ".opencode", "skills", "opencode-workspace", "SKILL.md"),
      "---\nname: OpenCode Workspace\n---",
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir })
    const result = await service.discover({
      scope: "all",
      workspace: {
        workspaceId: "workspace_skill_matrix",
        backendType: "local",
        rootPath: workspaceRoot,
      },
    })

    expect(result.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Agents Global", source: "agents", level: "global" }),
      expect.objectContaining({ name: "Codex Global", source: "codex", level: "global" }),
      expect.objectContaining({ name: "Claude Global", source: "claude-code", level: "global" }),
      expect.objectContaining({ name: "OpenCode Global", source: "opencode", level: "global" }),
      expect.objectContaining({ name: "Agents Workspace", source: "agents", level: "workspace" }),
      expect.objectContaining({ name: "Codex Workspace", source: "codex", level: "workspace" }),
      expect.objectContaining({ name: "Claude Workspace", source: "claude-code", level: "workspace" }),
      expect.objectContaining({ name: "OpenCode Workspace", source: "opencode", level: "workspace" }),
    ]))
    expect(JSON.stringify(result)).not.toContain(homeDir)
    expect(JSON.stringify(result)).not.toContain(workspaceRoot)
  })

  test("discovers MCP server summaries and redacts sensitive values", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-mcp-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")

    await writeText(
      join(homeDir, ".codex", "config.toml"),
      [
        "[mcp_servers.github]",
        "command = \"node\"",
        "args = [\"server.js\", \"--token\", \"sk-secret\"]",
        "[mcp_servers.github.env]",
        "GITHUB_TOKEN = \"ghp_secret\"",
      ].join("\n"),
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir })
    const result = await service.discover({ scope: "global" })
    const server = result.mcps.find((item) => item.name === "github")

    expect(server).toMatchObject({
      source: "codex",
      level: "global",
      transport: "stdio",
      command: "node",
      valid: true,
    })
    expect(JSON.stringify(result)).not.toContain("sk-secret")
    expect(JSON.stringify(result)).not.toContain("ghp_secret")
  })

  test("discovers MCP server summaries across global and workspace source families", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-mcp-matrix-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    const workspaceRoot = join(root, "workspace")

    await writeText(
      join(homeDir, ".agents", "mcp.json"),
      JSON.stringify({ mcpServers: { agents_global: { command: "node" } } }),
    )
    await writeText(
      join(homeDir, ".codex", "config.toml"),
      ["[mcp_servers.codex_global]", "command = \"npx\""].join("\n"),
    )
    await writeText(
      join(homeDir, ".claude.json"),
      JSON.stringify({ mcpServers: { claude_global: { type: "http", url: "https://claude.example/mcp" } } }),
    )
    await writeText(
      join(homeDir, ".config", "opencode", "opencode.jsonc"),
      [
        "{",
        "  // OpenCode supports JSONC.",
        "  \"mcp\": {",
        "    \"opencode_global\": {",
        "      \"type\": \"remote\",",
        "      \"url\": \"https://opencode.example/mcp\",",
        "    },",
        "  },",
        "}",
      ].join("\n"),
    )
    await writeText(
      join(workspaceRoot, ".agents", "mcp.json"),
      JSON.stringify({ mcpServers: { agents_workspace: { command: "node" } } }),
    )
    await writeText(
      join(workspaceRoot, ".codex", "config.toml"),
      ["[mcp_servers.codex_workspace]", "command = \"npx\""].join("\n"),
    )
    await writeText(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { claude_workspace: { command: "python", args: ["server.py"] } } }),
    )
    await writeText(
      join(workspaceRoot, "opencode.json"),
      JSON.stringify({
        mcp: {
          opencode_workspace: {
            type: "local",
            command: ["bun", "x", "@example/mcp"],
          },
        },
      }),
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir })
    const result = await service.discover({
      scope: "all",
      workspace: {
        workspaceId: "workspace_matrix",
        backendType: "local",
        rootPath: workspaceRoot,
      },
    })

    expect(result.mcps).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "agents_global", source: "agents", level: "global" }),
      expect.objectContaining({ name: "codex_global", source: "codex", level: "global" }),
      expect.objectContaining({ name: "claude_global", source: "claude-code", level: "global" }),
      expect.objectContaining({ name: "opencode_global", source: "opencode", level: "global", transport: "http" }),
      expect.objectContaining({ name: "agents_workspace", source: "agents", level: "workspace" }),
      expect.objectContaining({ name: "codex_workspace", source: "codex", level: "workspace" }),
      expect.objectContaining({ name: "claude_workspace", source: "claude-code", level: "workspace" }),
      expect.objectContaining({
        name: "opencode_workspace",
        source: "opencode",
        level: "workspace",
        transport: "stdio",
        command: "bun",
        args: ["x", "@example/mcp"],
      }),
    ]))
    expect(JSON.stringify(result)).not.toContain(homeDir)
    expect(JSON.stringify(result)).not.toContain(workspaceRoot)
  })

  test("returns cache metadata and reuses unchanged discovery results", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-cache-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    await writeText(
      join(homeDir, ".agents", "skills", "global-skill", "SKILL.md"),
      ["---", "name: Global Skill", "---"].join("\n"),
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir, cacheTtlMs: 30_000 })
    const first = await service.discover({ scope: "global" })
    const second = await service.discover({ scope: "global" })

    expect(first.cache).toMatchObject({ hit: false, refreshed: true })
    expect(second.cache).toMatchObject({
      hit: true,
      refreshed: false,
      cacheKey: first.cache?.cacheKey,
      fingerprint: first.cache?.fingerprint,
    })
  })

  test("refreshes cached results when the discovery fingerprint changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-fingerprint-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    await writeText(
      join(homeDir, ".agents", "skills", "first-skill", "SKILL.md"),
      ["---", "name: First Skill", "---"].join("\n"),
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir, cacheTtlMs: 30_000 })
    await service.discover({ scope: "global" })
    await writeText(
      join(homeDir, ".agents", "skills", "second-skill", "SKILL.md"),
      ["---", "name: Second Skill", "---"].join("\n"),
    )

    const next = await service.discover({ scope: "global" })
    expect(next.cache).toMatchObject({ hit: false, refreshed: true })
    expect(next.skills).toContainEqual(expect.objectContaining({ name: "Second Skill" }))
  })

  test("filters discovery by requested sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-sources-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    await writeText(
      join(homeDir, ".agents", "skills", "agents-skill", "SKILL.md"),
      ["---", "name: Agents Skill", "---"].join("\n"),
    )
    await writeText(
      join(homeDir, ".codex", "skills", "codex-skill", "SKILL.md"),
      ["---", "name: Codex Skill", "---"].join("\n"),
    )

    const service = new CapabilityDiscoveryService({ homeDir, dataDir })
    const result = await service.discover({ scope: "global", sources: ["codex"] })

    expect(result.skills.map((skill) => skill.source)).toEqual(["codex"])
    expect(result.skills).toContainEqual(expect.objectContaining({ name: "Codex Skill" }))
  })

  test("reports redacted refresh errors in service status and recovers after success", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-status-"))
    const service = new CapabilityDiscoveryService({
      homeDir: join(root, "home"),
      dataDir: join(root, "data"),
    })
    ;(service as any).performDiscovery = async () => {
      throw new Error("refresh failed at D:\\Secrets\\project\\.env with token=sk-secret123456")
    }

    await expect(service.refresh({ scope: "global" })).rejects.toThrow("refresh failed")

    const failedStatus = service.getStatus("2026-06-07T00:00:00.000Z")
    expect(failedStatus).toMatchObject({
      id: "capability-discovery",
      status: "error",
      details: expect.objectContaining({
        latestError: "refresh failed at [REDACTED_PATH] with token=[REDACTED]",
      }),
    })
    expect(JSON.stringify(failedStatus)).not.toContain("D:\\Secrets")
    expect(JSON.stringify(failedStatus)).not.toContain("sk-secret123456")

    ;(service as any).performDiscovery = async (request: { scope: "all" | "global" | "workspace" }) => ({
      discoveredAt: "2026-06-07T00:00:00.000Z",
      scope: request.scope,
      skills: [],
      mcps: [],
      warnings: [],
    })

    await service.refresh({ scope: "global" })
    const recoveredStatus = service.getStatus("2026-06-07T00:00:01.000Z")

    expect(recoveredStatus.status).toBe("idle")
    expect(recoveredStatus.details.latestError).toBeUndefined()
    expect(recoveredStatus.details.latestRefreshAt).toBeDefined()
  })
})

describe("capabilities router", () => {
  test("requires workspace snapshot for workspace discovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-router-"))
    const app = createApp(new CapabilityDiscoveryService({
      homeDir: join(root, "home"),
      dataDir: join(root, "data"),
    }))

    const response = await app.request("/runtime/capabilities/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "workspace" }),
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("CAPABILITY_WORKSPACE_REQUIRED")
  })

  test("GET /runtime/capabilities returns global-only discovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-router-get-"))
    const homeDir = join(root, "home")
    await writeText(
      join(homeDir, ".agents", "skills", "global-skill", "SKILL.md"),
      ["---", "name: Global Skill", "---"].join("\n"),
    )

    const app = createApp(new CapabilityDiscoveryService({
      homeDir,
      dataDir: join(root, "data"),
    }))
    const response = await app.request("/runtime/capabilities")
    const body = await response.json() as { scope: string; skills: Array<{ level: string }> }

    expect(response.status).toBe(200)
    expect(body.scope).toBe("global")
    expect(body.skills).toContainEqual(expect.objectContaining({ level: "global" }))
  })

  test("GET /runtime/capabilities rejects workspace scope without a snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-router-scope-"))
    const app = createApp(new CapabilityDiscoveryService({
      homeDir: join(root, "home"),
      dataDir: join(root, "data"),
    }))

    const response = await app.request("/runtime/capabilities?scope=workspace")
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("CAPABILITY_WORKSPACE_REQUIRED")
  })

  test("POST /runtime/capabilities/refresh force refreshes cached discovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-capabilities-router-refresh-"))
    const homeDir = join(root, "home")
    await writeText(
      join(homeDir, ".codex", "skills", "codex-skill", "SKILL.md"),
      ["---", "name: Codex Skill", "---"].join("\n"),
    )

    const app = createApp(new CapabilityDiscoveryService({
      homeDir,
      dataDir: join(root, "data"),
      cacheTtlMs: 30_000,
    }))
    await app.request("/runtime/capabilities/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "global", sources: ["codex"] }),
    })

    const response = await app.request("/runtime/capabilities/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "global", sources: ["codex"] }),
    })
    const body = await response.json() as {
      cache?: { hit: boolean; refreshed: boolean }
      skills: Array<{ source: string }>
    }

    expect(response.status).toBe(200)
    expect(body.cache).toMatchObject({ hit: false, refreshed: true })
    expect(body.skills.map((skill) => skill.source)).toEqual(["codex"])
  })
})
