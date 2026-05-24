import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RuntimeToolRegistry, createWorkspaceReadOnlyTools, WorkspaceService } from "../src/runtime"
import type { AgentDefinition, RunEvent, RunInput } from "../src/runtime"

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kv6QAAAAASUVORK5CYII="

const coderAgent: AgentDefinition = {
  id: "coder",
  name: "Coder",
  description: "Test coder agent",
  tier: "primary",
  origin: "system",
  visibility: "visible",
  entryPolicy: "callable",
  delegationPolicy: "can-delegate",
  executorType: "ai-sdk",
  modelRef: {
    providerId: "openai",
    modelId: "gpt-5.1",
  },
  capabilities: ["implementation"],
  allowedSubagents: [],
  allowedTools: ["ls", "read_file", "glob", "grep"],
  permissionPolicy: {
    filesystem: "read",
    shell: "none",
    network: "none",
    deploy: "none",
    requiresApproval: false,
  },
  enabled: true,
  readonly: true,
}

async function createWorkspaceFixture(): Promise<{
  workspaceRoot: string
  externalRoot: string
  workspaceService: WorkspaceService
}> {
  const baseDir = await mkdtemp(join(tmpdir(), "agent-runtime-workspace-tools-"))
  const workspaceRoot = join(baseDir, "workspace")
  const externalRoot = join(baseDir, "external")

  await mkdir(join(workspaceRoot, "src"), { recursive: true })
  await mkdir(join(workspaceRoot, "docs"), { recursive: true })
  await mkdir(join(workspaceRoot, "assets"), { recursive: true })
  await mkdir(externalRoot, { recursive: true })

  await writeFile(join(workspaceRoot, "src", "index.ts"), [
    "export const value = 1",
    "const needle = 'present here'",
  ].join("\n"), "utf-8")
  await writeFile(join(workspaceRoot, "docs", "readme.md"), [
    "# Workspace",
    "This file does not contain the search term.",
  ].join("\n"), "utf-8")
  await writeFile(join(workspaceRoot, ".env"), "SECRET=should-not-appear", "utf-8")
  await writeFile(join(workspaceRoot, "assets", "logo.png"), Buffer.from(PNG_BASE64, "base64"))
  await writeFile(join(externalRoot, "secret.txt"), "external secret content", "utf-8")

  const workspaceService = new WorkspaceService({
    workdir: workspaceRoot,
    workspaceId: "workspace_test",
  })

  return {
    workspaceRoot,
    externalRoot,
    workspaceService,
  }
}

function createBaseRunInput(): RunInput {
  return {
    conversationId: "conv_tools",
    mode: "single",
    participantAgentIds: ["coder"],
    addressedAgentIds: ["coder"],
    userMessage: {
      role: "user",
      content: "Inspect the workspace.",
    },
    history: [],
  }
}

describe("Workspace read-only tools", () => {
  test("list, read, glob and grep work inside the sandbox and hide sensitive files", async () => {
    const { workspaceService } = await createWorkspaceFixture()
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_tools",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => {
        events.push(event)
      },
      workspaceService,
    }

    const lsResult = await registry.executeTool("ls", { path: "." }, context, { toolCallId: "tool_ls" })
    expect(lsResult.status).toBe("completed")
    const lsEntries = (lsResult.data as { entries: Array<{ path: string }> }).entries
    expect(lsEntries.some((entry) => entry.path.includes(".env"))).toBe(false)
    expect(lsEntries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "assets",
      "docs",
      "src",
    ]))

    const readResult = await registry.executeTool("read_file", { path: "src/index.ts" }, context, {
      toolCallId: "tool_read",
    })
    expect(readResult.status).toBe("completed")
    const readData = readResult.data as { path: string; blocks: Array<{ type: string; text?: string; mimeType?: string }> }
    expect(readData.path).toBe("src/index.ts")
    expect(readData.blocks[0]?.type).toBe("text")
    expect(readData.blocks[0] && "text" in readData.blocks[0] ? readData.blocks[0].text : "").toContain("needle")

    const imageResult = await registry.executeTool("read_file", { path: "assets/logo.png" }, context, {
      toolCallId: "tool_image",
    })
    expect(imageResult.status).toBe("completed")
    const imageData = imageResult.data as { blocks: Array<{ type: string; mimeType?: string }> }
    expect(imageData.blocks[0]?.type).toBe("image")
    expect(imageData.blocks[0] && "mimeType" in imageData.blocks[0] ? imageData.blocks[0].mimeType : "").toBe("image/png")

    const globResult = await registry.executeTool("glob", { path: ".", pattern: "**/*.ts" }, context, {
      toolCallId: "tool_glob",
    })
    expect(globResult.status).toBe("completed")
    const globMatches = (globResult.data as { matches: string[] }).matches
    expect(globMatches).toContain("src/index.ts")

    const grepResult = await registry.executeTool("grep", { path: ".", pattern: "needle" }, context, {
      toolCallId: "tool_grep",
    })
    expect(grepResult.status).toBe("completed")
    const grepMatches = (grepResult.data as { matches: Array<{ path: string; line: number; snippet: string }> }).matches
    expect(grepMatches[0]?.path).toBe("src/index.ts")
    expect(grepMatches[0]?.snippet).toContain("needle")
  })

  test("external files request approval and succeed after approval", async () => {
    const { workspaceService, externalRoot } = await createWorkspaceFixture()
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_external",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => {
        events.push(event)
      },
      workspaceService,
    }

    const externalPath = join(externalRoot, "secret.txt")
    const firstAttempt = await registry.executeTool("read_file", { path: `../external/secret.txt` }, context, {
      toolCallId: "tool_external_1",
    })

    expect(firstAttempt.status).toBe("failed")
    expect(firstAttempt.error?.code).toBe("WORKSPACE_EXTERNAL_ACCESS_PENDING_APPROVAL")
    expect(events.some((event) => event.type === "permission.requested")).toBe(true)

    const requestId = (firstAttempt.runtime as { request?: { requestId: string } } | undefined)?.request?.requestId
    expect(requestId).toBeTruthy()

    const grant = workspaceService.approveExternalAccess(requestId as string)
    expect(grant?.targetPath).toBe(externalPath)

    events.length = 0
    const secondAttempt = await registry.executeTool("read_file", { path: `../external/secret.txt` }, context, {
      toolCallId: "tool_external_2",
    })

    expect(secondAttempt.status).toBe("completed")
    const data = secondAttempt.data as { blocks: Array<{ type: string; text?: string }> }
    expect(data.blocks[0]?.type).toBe("text")
    expect(data.blocks[0] && "text" in data.blocks[0] ? data.blocks[0].text : "").toContain("external secret content")
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)
  })

  test("sensitive workspace files stay blocked", async () => {
    const { workspaceService } = await createWorkspaceFixture()
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }

    const context = {
      runId: "run_workspace_sensitive",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: () => {},
      workspaceService,
    }

    const result = await registry.executeTool("read_file", { path: ".env" }, context, {
      toolCallId: "tool_sensitive",
    })

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("WORKSPACE_SENSITIVE_PATH_BLOCKED")
  })
})
