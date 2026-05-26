import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  RuntimePermissionService,
  RuntimeToolRegistry,
  createWorkspaceReadOnlyTools,
  createWorkspaceWriteTools,
  WorkspaceService,
} from "../src/runtime"
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
  capabilities: ["implementation"],
  allowedSubagents: [],
  allowedTools: ["ls", "read_file", "glob", "grep"],
  permissionPolicy: {
    filesystem: "read",
    shell: "none",
    network: "none",
    deploy: "none",
  },
  enabled: true,
  readonly: true,
}

const writableAgent: AgentDefinition = {
  ...coderAgent,
  id: "writer",
  name: "Writer",
  allowedTools: ["ls", "read_file", "glob", "grep", "write_file", "edit_file"],
  permissionPolicy: {
    filesystem: "write",
    shell: "none",
    network: "none",
    deploy: "none",
  },
}

async function createWorkspaceFixture(runId: string): Promise<{
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
  await writeFile(join(workspaceRoot, "AGENTS.md"), "private instructions", "utf-8")
  await writeFile(join(workspaceRoot, "assets", "logo.png"), Buffer.from(PNG_BASE64, "base64"))
  await writeFile(join(externalRoot, "secret.txt"), "external secret content", "utf-8")
  await writeFile(join(externalRoot, ".env"), "EXTERNAL_SECRET=combined-approval", "utf-8")

  const workspaceService = new WorkspaceService({
    workdir: workspaceRoot,
    workspaceId: "workspace_test",
    runId,
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
    const { workspaceService } = await createWorkspaceFixture("run_workspace_tools")
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
      permissionService: new RuntimePermissionService(workspaceService),
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
    const { workspaceService, externalRoot } = await createWorkspaceFixture("run_workspace_external")
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
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const externalPath = join(externalRoot, "secret.txt")
    const firstAttempt = await registry.executeTool("read_file", { path: `../external/secret.txt` }, context, {
      toolCallId: "tool_external_1",
    })

    expect(firstAttempt.status).toBe("failed")
    expect(firstAttempt.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.some((event) => event.type === "permission.requested")).toBe(true)
    expect(events.some((event) => event.type === "tool.started")).toBe(false)

    const requestId = workspaceService.listExternalAccessRequests()[0]?.requestId
    expect(requestId).toBeTruthy()

    const grant = workspaceService.approveExternalAccess(requestId as string)
    expect(grant?.targetPath).toBe(externalPath)

    events.length = 0
    const secondAttempt = await registry.executeTool("read_file", { path: `../external/secret.txt` }, context, {
      toolCallId: "tool_external_2",
    })

    expect(secondAttempt.status).toBe("completed")
    const data = secondAttempt.data as { path: string; blocks: Array<{ type: string; text?: string }> }
    expect(data.path).toStartWith("mounts/")
    expect(data.path).not.toContain(externalRoot)
    expect(data.blocks[0]?.type).toBe("text")
    expect(data.blocks[0] && "text" in data.blocks[0] ? data.blocks[0].text : "").toContain("external secret content")
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)
  })

  test("explicit sensitive reads require approval and use an exact read grant", async () => {
    const { workspaceService } = await createWorkspaceFixture("run_workspace_sensitive")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_sensitive",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const result = await registry.executeTool("read_file", { path: ".env" }, context, {
      toolCallId: "tool_sensitive",
    })

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.some((event) => event.type === "permission.requested")).toBe(true)

    const request = workspaceService.listExternalAccessRequests()[0]!
    expect(request.approvalReason).toBe("sensitive_read")
    expect(request.logicalPath).toBe(".env")
    expect(workspaceService.approveReadAccess(request.requestId)?.allowSensitive).toBe(true)

    const approved = await registry.executeTool("read_file", { path: ".env" }, context, {
      toolCallId: "tool_sensitive_approved",
    })
    expect(approved.status).toBe("completed")
    expect((approved.data as { path: string }).path).toBe(".env")
  })

  test("explicit sensitive grep requires approval while recursive grep skips sensitive files", async () => {
    const { workspaceService } = await createWorkspaceFixture("run_workspace_sensitive_grep")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_sensitive_grep",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const recursive = await registry.executeTool("grep", { path: ".", pattern: "SECRET" }, context, {
      toolCallId: "tool_recursive_grep",
    })
    expect(recursive.status).toBe("completed")
    expect((recursive.data as { matches: unknown[] }).matches).toHaveLength(0)
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)

    const explicit = await registry.executeTool("grep", { path: ".env", pattern: "SECRET" }, context, {
      toolCallId: "tool_sensitive_grep",
    })
    expect(explicit.status).toBe("failed")
    expect(explicit.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    const request = workspaceService.listExternalAccessRequests().find((candidate) =>
      candidate.status === "pending"
    )!
    expect(request.approvalReason).toBe("sensitive_read")

    workspaceService.approveReadAccess(request.requestId)
    const approved = await registry.executeTool("grep", { path: ".env", pattern: "SECRET" }, context, {
      toolCallId: "tool_sensitive_grep_approved",
    })
    expect(approved.status).toBe("completed")
    const matches = (approved.data as { matches: Array<{ path: string; snippet: string }> }).matches
    expect(matches[0]?.path).toBe(".env")
    expect(matches[0]?.snippet).toContain("SECRET")
  })

  test("external sensitive file reads use one combined approval and redact absolute paths from events", async () => {
    const { workspaceService, externalRoot } = await createWorkspaceFixture("run_workspace_external_sensitive")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_external_sensitive",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const externalEnvPath = join(externalRoot, ".env")
    const first = await registry.executeTool("read_file", { path: externalEnvPath }, context, {
      toolCallId: "tool_external_sensitive",
    })
    expect(first.status).toBe("failed")
    expect(first.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.filter((event) => event.type === "permission.requested")).toHaveLength(1)
    expect(events.some((event) => event.type === "tool.started")).toBe(false)
    expect(JSON.stringify(events)).not.toContain(externalRoot)

    const request = workspaceService.listExternalAccessRequests()[0]!
    expect(request.approvalReason).toBe("external_sensitive_read")
    expect(request.targetKind).toBe("file")
    workspaceService.approveReadAccess(request.requestId)

    events.length = 0
    const approved = await registry.executeTool("read_file", { path: externalEnvPath }, context, {
      toolCallId: "tool_external_sensitive_approved",
    })
    expect(approved.status).toBe("completed")
    const data = approved.data as { path: string; blocks: Array<{ type: string; text?: string }> }
    expect(data.path).toStartWith("mounts/")
    expect(data.blocks[0]?.type).toBe("text")
    expect(data.blocks[0] && "text" in data.blocks[0] ? data.blocks[0].text : "").toContain("combined-approval")
    expect(JSON.stringify(events)).not.toContain(externalRoot)
  })

  test("external directory grants do not unlock sensitive files inside that directory", async () => {
    const { workspaceService } = await createWorkspaceFixture("run_workspace_external_dir_sensitive")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_external_dir_sensitive",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const first = await registry.executeTool("ls", { path: "../external" }, context, {
      toolCallId: "tool_external_dir",
    })
    expect(first.status).toBe("failed")
    const directoryRequest = workspaceService.listExternalAccessRequests()[0]!
    expect(directoryRequest.approvalReason).toBe("external_read")
    workspaceService.approveReadAccess(directoryRequest.requestId)

    const listed = await registry.executeTool("ls", { path: "../external" }, context, {
      toolCallId: "tool_external_dir_approved",
    })
    expect(listed.status).toBe("completed")
    const paths = (listed.data as { entries: Array<{ path: string }> }).entries.map((entry) => entry.path)
    expect(paths.some((path) => path.endsWith("secret.txt"))).toBe(true)
    expect(paths.some((path) => path.endsWith(".env"))).toBe(false)

    const sensitive = await registry.executeTool("read_file", { path: "../external/.env" }, context, {
      toolCallId: "tool_external_dir_sensitive",
    })
    expect(sensitive.status).toBe("failed")
    expect(sensitive.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    const sensitiveRequest = workspaceService.listExternalAccessRequests().find((candidate) =>
      candidate.status === "pending"
    )!
    expect(sensitiveRequest.approvalReason).toBe("external_sensitive_read")
  })

  test("directory enumeration hides sensitive files without prompting", async () => {
    const { workspaceService } = await createWorkspaceFixture("run_workspace_hidden")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }
    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_hidden",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const result = await registry.executeTool("ls", { path: "." }, context, { toolCallId: "tool_hidden_ls" })
    const paths = (result.data as { entries: Array<{ path: string }> }).entries.map((entry) => entry.path)
    expect(paths).not.toContain(".env")
    expect(paths).not.toContain("AGENTS.md")
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)
  })

  test("file tools fail clearly without a bound workspace", async () => {
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceReadOnlyTools()) {
      registry.register(tool)
    }
    const result = await registry.executeTool("read_file", { path: "src/index.ts" }, {
      runId: "run_no_workspace",
      input: createBaseRunInput(),
      agent: coderAgent,
      signal: new AbortController().signal,
      emitEvent: () => {},
    }, { toolCallId: "tool_no_workspace" })

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("WORKSPACE_NOT_BOUND")
  })

  test("write_file and edit_file modify ordinary workspace files without approval", async () => {
    const { workspaceService, workspaceRoot } = await createWorkspaceFixture("run_workspace_write")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceWriteTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_write",
      input: createBaseRunInput(),
      agent: writableAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const created = await registry.executeTool("write_file", {
      path: "src/generated.txt",
      content: "hello from write_file",
    }, context, { toolCallId: "tool_write_create" })
    expect(created.status).toBe("completed")
    expect(created.data).toMatchObject({
      path: "src/generated.txt",
      created: true,
      overwritten: false,
    })
    expect(await readFile(join(workspaceRoot, "src", "generated.txt"), "utf-8")).toBe("hello from write_file")
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)

    const conflict = await registry.executeTool("write_file", {
      path: "src/generated.txt",
      content: "should not replace",
    }, context, { toolCallId: "tool_write_conflict" })
    expect(conflict.status).toBe("failed")
    expect(conflict.error?.code).toBe("WORKSPACE_PATH_ALREADY_EXISTS")
    expect(await readFile(join(workspaceRoot, "src", "generated.txt"), "utf-8")).toBe("hello from write_file")

    const edited = await registry.executeTool("edit_file", {
      path: "src/index.ts",
      search: "value = 1",
      replace: "value = 2",
      expectedReplacements: 1,
    }, context, { toolCallId: "tool_edit" })
    expect(edited.status).toBe("completed")
    expect(edited.data).toMatchObject({
      path: "src/index.ts",
      replacements: 1,
      changed: true,
    })
    expect(await readFile(join(workspaceRoot, "src", "index.ts"), "utf-8")).toContain("value = 2")

    const missingSearch = await registry.executeTool("edit_file", {
      path: "src/index.ts",
      search: "not present",
      replace: "replacement",
    }, context, { toolCallId: "tool_edit_missing" })
    expect(missingSearch.status).toBe("failed")
    expect(missingSearch.error?.code).toBe("WORKSPACE_EDIT_CONFLICT")
  })

  test("sensitive workspace writes require approval and resume with a write grant", async () => {
    const { workspaceService, workspaceRoot } = await createWorkspaceFixture("run_workspace_sensitive_write")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceWriteTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_sensitive_write",
      input: createBaseRunInput(),
      agent: writableAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const first = await registry.executeTool("write_file", {
      path: ".env",
      content: "SECRET=updated",
      overwrite: true,
    }, context, { toolCallId: "tool_sensitive_write" })
    expect(first.status).toBe("failed")
    expect(first.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.some((event) => event.type === "tool.started")).toBe(false)

    const request = workspaceService.listExternalAccessRequests()[0]!
    expect(request.accessMode).toBe("write")
    expect(request.approvalReason).toBe("sensitive_write")
    expect(workspaceService.approveWriteAccess(request.requestId)?.accessMode).toBe("write")

    const approved = await registry.executeTool("write_file", {
      path: ".env",
      content: "SECRET=updated",
      overwrite: true,
    }, context, { toolCallId: "tool_sensitive_write_approved" })
    expect(approved.status).toBe("completed")
    expect(await readFile(join(workspaceRoot, ".env"), "utf-8")).toBe("SECRET=updated")
  })

  test("external ordinary and external sensitive writes require scoped write approval", async () => {
    const { workspaceService, externalRoot } = await createWorkspaceFixture("run_workspace_external_write")
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceWriteTools()) {
      registry.register(tool)
    }

    const events: RunEvent[] = []
    const context = {
      runId: "run_workspace_external_write",
      input: createBaseRunInput(),
      agent: writableAgent,
      signal: new AbortController().signal,
      emitEvent: (event: RunEvent) => events.push(event),
      workspaceService,
      permissionService: new RuntimePermissionService(workspaceService),
    }

    const externalFile = join(externalRoot, "generated.txt")
    const first = await registry.executeTool("write_file", {
      path: externalFile,
      content: "external write",
    }, context, { toolCallId: "tool_external_write" })
    expect(first.status).toBe("failed")
    expect(first.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(JSON.stringify(events)).not.toContain(externalRoot)

    const externalRequest = workspaceService.listExternalAccessRequests()[0]!
    expect(externalRequest.accessMode).toBe("write")
    expect(externalRequest.approvalReason).toBe("external_write")
    workspaceService.approveWriteAccess(externalRequest.requestId)

    const approved = await registry.executeTool("write_file", {
      path: externalFile,
      content: "external write",
    }, context, { toolCallId: "tool_external_write_approved" })
    expect(approved.status).toBe("completed")
    expect((approved.data as { path: string }).path).toStartWith("mounts/")
    expect(await readFile(externalFile, "utf-8")).toBe("external write")

    events.length = 0
    const sensitive = await registry.executeTool("write_file", {
      path: join(externalRoot, ".env"),
      content: "EXTERNAL_SECRET=updated",
      overwrite: true,
    }, context, { toolCallId: "tool_external_sensitive_write" })
    expect(sensitive.status).toBe("failed")
    expect(sensitive.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.filter((event) => event.type === "permission.requested")).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain(externalRoot)

    const sensitiveRequest = workspaceService.listExternalAccessRequests().find((candidate) =>
      candidate.status === "pending"
    )!
    expect(sensitiveRequest.accessMode).toBe("write")
    expect(sensitiveRequest.approvalReason).toBe("external_sensitive_write")
  })

  test("write tools fail clearly without a bound workspace", async () => {
    const registry = new RuntimeToolRegistry()
    for (const tool of createWorkspaceWriteTools()) {
      registry.register(tool)
    }
    const result = await registry.executeTool("write_file", {
      path: "src/generated.txt",
      content: "no workspace",
    }, {
      runId: "run_no_workspace_write",
      input: createBaseRunInput(),
      agent: writableAgent,
      signal: new AbortController().signal,
      emitEvent: () => {},
    }, { toolCallId: "tool_no_workspace_write" })

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("WORKSPACE_NOT_BOUND")
  })
})
