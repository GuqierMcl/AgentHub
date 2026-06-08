import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import type { ProviderService } from "../src/provider"
import {
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  RunManager,
  type AgentExecutionContext,
  type ResolvedSkillContent,
  type RunEvent,
} from "../src/runtime"
import type { SkillContentService } from "../src/runtime/skill-content"

async function createRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-skill-run-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

async function waitForStatus(manager: RunManager, runId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (manager.getRun(runId)?.status === status) {
      return
    }
    await Bun.sleep(10)
  }

  throw new Error(`Run ${runId} did not reach ${status}`)
}

const resolvedSkill: ResolvedSkillContent = {
  id: "global:agents:review",
  ref: "global:agents:review",
  name: "Review Skill",
  source: "agents",
  level: "global",
  body: "Always inspect tests before claiming completion.",
  truncated: false,
  contentChars: 48,
  relativeRefs: [],
  warnings: [],
}

describe("RunManager Skill injection", () => {
  test("resolves allowed Skill content for execution and emits metadata-only diagnostics", async () => {
    const registry = await createRegistry()
    const agent = await registry.createUserAgent({
      id: "skill_runtime_agent",
      name: "Skill Runtime Agent",
      description: "Uses a global Skill during execution.",
      systemPrompt: "Follow configured instructions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: ["global:agents:review"],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
      enabled: true,
    })

    const toolRegistry = createDefaultRuntimeToolRegistry()
    const skillContentService = {
      async resolve(request: { skillRefs: string[] }) {
        expect(request.skillRefs).toEqual(["global:agents:review"])
        return { skills: [resolvedSkill], warnings: [] }
      },
    } as unknown as SkillContentService
    const manager = new RunManager(
      registry,
      {} as ProviderService,
      undefined,
      toolRegistry,
      undefined,
      undefined,
      skillContentService,
    )

    let observedSkills: ResolvedSkillContent[] | undefined
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        observedSkills = context.injectedSkills
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }
    const run = manager.createRun({
      conversationId: "conv_skill_runtime",
      mode: "single",
      participantAgentIds: [agent.id],
      addressedAgentIds: [agent.id],
      userMessage: {
        role: "user",
        content: "Use your configured skill.",
      },
      history: [],
      diagnostics: {
        includeSkillDiagnostics: true,
      },
    })

    await waitForStatus(manager, run.id, "completed")

    expect(observedSkills?.[0]?.body).toContain("Always inspect tests")

    const diagnostic = manager.getEvents(run.id)?.find((event) =>
      event.type === "agent.skill_context.resolved"
    )
    expect(diagnostic?.data).toMatchObject({
      status: "resolved",
      skills: [
        expect.objectContaining({
          id: "global:agents:review",
          ref: "global:agents:review",
          name: "Review Skill",
          source: "agents",
          level: "global",
          truncated: false,
        }),
      ],
      warnings: [],
    })
    expect(JSON.stringify(diagnostic)).not.toContain("Always inspect tests")
  })

  test("skips untrusted workspace Skill refs with metadata-only diagnostics", async () => {
    const registry = await createRegistry()
    const agent = await registry.createUserAgent({
      id: "workspace_skill_runtime_agent",
      name: "Workspace Skill Runtime Agent",
      description: "References a workspace Skill.",
      systemPrompt: "Follow configured instructions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: ["workspace:agents:review"],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
      enabled: true,
    })

    const toolRegistry = createDefaultRuntimeToolRegistry()
    const skillContentService = {
      async resolve() {
        throw new Error("SkillContentService should not be called for untrusted workspace refs")
      },
    } as unknown as SkillContentService
    const workspaceSkillTrustService = {
      async isTrusted() {
        return false
      },
    }
    const manager = new RunManager(
      registry,
      {} as ProviderService,
      undefined,
      toolRegistry,
      undefined,
      undefined,
      skillContentService,
      workspaceSkillTrustService as any,
    )

    let observedSkills: ResolvedSkillContent[] | undefined
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        observedSkills = context.injectedSkills
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-runtime-untrusted-workspace-"))

    const run = manager.createRun({
      conversationId: "conv_workspace_skill_untrusted",
      mode: "single",
      participantAgentIds: [agent.id],
      addressedAgentIds: [agent.id],
      userMessage: {
        role: "user",
        content: "Use workspace skill if trusted.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_untrusted",
        backendType: "local",
        rootPath: workspaceRoot,
      },
      diagnostics: {
        includeSkillDiagnostics: true,
      },
    })

    await waitForStatus(manager, run.id, "completed")

    expect(observedSkills).toEqual([])
    const diagnostic = manager.getEvents(run.id)?.find((event) =>
      event.type === "agent.skill_context.resolved"
    )
    expect(diagnostic?.data).toMatchObject({
      status: "skipped",
      skills: [],
      warnings: expect.arrayContaining([
        "Workspace Skill workspace:agents:review is not trusted for this workspace.",
      ]),
    })
    expect(JSON.stringify(diagnostic)).not.toContain(workspaceRoot)
  })

  test("injects trusted workspace Skill refs for user agents", async () => {
    const registry = await createRegistry()
    const agent = await registry.createUserAgent({
      id: "trusted_workspace_skill_agent",
      name: "Trusted Workspace Skill Agent",
      description: "Uses trusted workspace Skills.",
      systemPrompt: "Follow configured instructions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: ["workspace:agents:review"],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
      enabled: true,
    })

    const workspace = {
      workspaceId: "workspace_trusted",
      backendType: "local" as const,
      rootPath: await mkdtemp(join(tmpdir(), "agent-runtime-trusted-workspace-")),
    }
    const workspaceSkill: ResolvedSkillContent = {
      ...resolvedSkill,
      id: "workspace:agents:review",
      ref: "workspace:agents:review",
      level: "workspace",
    }
    const skillContentService = {
      async resolve(request: { skillRefs: string[]; workspace?: typeof workspace }) {
        expect(request.skillRefs).toEqual(["workspace:agents:review"])
        expect(request.workspace).toEqual(workspace)
        return { skills: [workspaceSkill], warnings: [] }
      },
    } as unknown as SkillContentService
    const workspaceSkillTrustService = {
      async isTrusted(request: { workspace: typeof workspace; skillRef: string }) {
        expect(request.workspace).toEqual(workspace)
        expect(request.skillRef).toBe("workspace:agents:review")
        return true
      },
    }
    const manager = new RunManager(
      registry,
      {} as ProviderService,
      undefined,
      createDefaultRuntimeToolRegistry(),
      undefined,
      undefined,
      skillContentService,
      workspaceSkillTrustService as any,
    )

    let observedSkills: ResolvedSkillContent[] | undefined
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        observedSkills = context.injectedSkills
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const run = manager.createRun({
      conversationId: "conv_workspace_skill_trusted",
      mode: "single",
      participantAgentIds: [agent.id],
      addressedAgentIds: [agent.id],
      userMessage: {
        role: "user",
        content: "Use trusted workspace skill.",
      },
      history: [],
      workspace,
      diagnostics: {
        includeSkillDiagnostics: true,
      },
    })

    await waitForStatus(manager, run.id, "completed")

    expect(observedSkills?.[0]?.ref).toBe("workspace:agents:review")
    expect(observedSkills?.[0]?.body).toContain("Always inspect tests")
    const diagnostic = manager.getEvents(run.id)?.find((event) =>
      event.type === "agent.skill_context.resolved"
    )
    expect(diagnostic?.data).toMatchObject({
      status: "resolved",
      skills: [
        expect.objectContaining({
          ref: "workspace:agents:review",
          level: "workspace",
        }),
      ],
      warnings: [],
    })
    expect(JSON.stringify(diagnostic)).not.toContain("Always inspect tests")
    expect(JSON.stringify(diagnostic)).not.toContain(workspace.rootPath)
  })

  test("auto injects trusted workspace Skills into the default Orchestrator context", async () => {
    const registry = await createRegistry()
    const workspace = {
      workspaceId: "workspace_orchestrator_auto",
      backendType: "local" as const,
      rootPath: await mkdtemp(join(tmpdir(), "agent-runtime-orchestrator-auto-workspace-")),
    }
    const workspaceSkill: ResolvedSkillContent = {
      ...resolvedSkill,
      id: "workspace:agents:review",
      ref: "workspace:agents:review",
      level: "workspace",
    }
    const skillContentService = {
      async listWorkspaceSkillRefs(requestWorkspace: typeof workspace) {
        expect(requestWorkspace).toEqual(workspace)
        return ["workspace:agents:review", "workspace:codex:style"]
      },
      async resolve(request: { skillRefs: string[]; workspace?: typeof workspace }) {
        expect(request.skillRefs).toEqual(["workspace:agents:review"])
        expect(request.workspace).toEqual(workspace)
        return { skills: [workspaceSkill], warnings: [] }
      },
    } as unknown as SkillContentService
    const workspaceSkillTrustService = {
      async isTrusted(request: { workspace: typeof workspace; skillRef: string }) {
        expect(request.workspace).toEqual(workspace)
        return request.skillRef !== "workspace:codex:style"
      },
    }
    const manager = new RunManager(
      registry,
      {} as ProviderService,
      undefined,
      createDefaultRuntimeToolRegistry(),
      undefined,
      undefined,
      skillContentService,
      workspaceSkillTrustService as any,
    )

    let observedSkills: ResolvedSkillContent[] | undefined
    ;(manager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        observedSkills = context.injectedSkills
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const run = manager.createRun({
      conversationId: "conv_orchestrator_auto_workspace_skill",
      mode: "group",
      participantAgentIds: ["orchestrator", "coder", "reviewer"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Use workspace instructions.",
      },
      history: [],
      workspace,
      diagnostics: {
        includeSkillDiagnostics: true,
      },
    })

    await waitForStatus(manager, run.id, "completed")

    expect(observedSkills?.map((skill) => skill.ref)).toEqual(["workspace:agents:review"])
    const diagnostic = manager.getEvents(run.id)?.find((event) =>
      event.type === "agent.skill_context.resolved"
    )
    expect(diagnostic?.data).toMatchObject({
      status: "partial",
      skills: [
        expect.objectContaining({
          ref: "workspace:agents:review",
          level: "workspace",
        }),
      ],
      warnings: expect.arrayContaining([
        "Workspace Skill workspace:codex:style is not trusted for this workspace.",
      ]),
    })
    expect(JSON.stringify(diagnostic)).not.toContain("Always inspect tests")
    expect(JSON.stringify(diagnostic)).not.toContain(workspace.rootPath)
  })

  test("deduplicates equivalent workspace Skills across source-specific refs before injection", async () => {
    const registry = await createRegistry()
    const workspace = {
      workspaceId: "workspace_orchestrator_dedupe",
      backendType: "local" as const,
      rootPath: await mkdtemp(join(tmpdir(), "agent-runtime-orchestrator-dedupe-workspace-")),
    }
    const workspaceSkill: ResolvedSkillContent = {
      ...resolvedSkill,
      id: "workspace:codex:review",
      ref: "workspace:codex:review",
      source: "codex",
      level: "workspace",
    }
    const trustedRefs: string[] = []
    const skillContentService = {
      async listWorkspaceSkillRefs(requestWorkspace: typeof workspace) {
        expect(requestWorkspace).toEqual(workspace)
        return ["workspace:opencode:review", "workspace:codex:review"]
      },
      async resolve(request: { skillRefs: string[]; workspace?: typeof workspace }) {
        expect(request.skillRefs).toEqual(["workspace:codex:review"])
        expect(request.workspace).toEqual(workspace)
        return { skills: [workspaceSkill], warnings: [] }
      },
    } as unknown as SkillContentService
    const workspaceSkillTrustService = {
      async isTrusted(request: { workspace: typeof workspace; skillRef: string }) {
        expect(request.workspace).toEqual(workspace)
        trustedRefs.push(request.skillRef)
        return true
      },
    }
    const manager = new RunManager(
      registry,
      {} as ProviderService,
      undefined,
      createDefaultRuntimeToolRegistry(),
      undefined,
      undefined,
      skillContentService,
      workspaceSkillTrustService as any,
    )

    let observedSkills: ResolvedSkillContent[] | undefined
    ;(manager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        observedSkills = context.injectedSkills
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const run = manager.createRun({
      conversationId: "conv_orchestrator_dedupe_workspace_skill",
      mode: "group",
      participantAgentIds: ["orchestrator", "coder"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Use one review skill.",
      },
      history: [],
      workspace,
      diagnostics: {
        includeSkillDiagnostics: true,
      },
    })

    await waitForStatus(manager, run.id, "completed")

    expect(trustedRefs).toEqual(["workspace:codex:review", "workspace:opencode:review"])
    expect(observedSkills?.map((skill) => skill.ref)).toEqual(["workspace:codex:review"])
    const diagnostic = manager.getEvents(run.id)?.find((event) =>
      event.type === "agent.skill_context.resolved"
    )
    expect(diagnostic?.data).toMatchObject({
      status: "resolved",
      skills: [
        expect.objectContaining({
          ref: "workspace:codex:review",
          source: "codex",
        }),
      ],
      warnings: [],
    })
  })

  test("does not auto inject workspace Skills into ordinary agents without allowed Skill refs", async () => {
    const registry = await createRegistry()
    const agent = await registry.createUserAgent({
      id: "ordinary_workspace_agent",
      name: "Ordinary Workspace Agent",
      description: "Has no configured Skills.",
      systemPrompt: "Answer normally.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: [],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
      enabled: true,
    })

    const skillContentService = {
      async listWorkspaceSkillRefs() {
        throw new Error("Ordinary agents should not auto discover workspace Skills")
      },
      async resolve() {
        throw new Error("Ordinary agents should not resolve Skill content without refs")
      },
    } as unknown as SkillContentService
    const manager = new RunManager(
      registry,
      {} as ProviderService,
      undefined,
      createDefaultRuntimeToolRegistry(),
      undefined,
      undefined,
      skillContentService,
    )

    let observedSkills: ResolvedSkillContent[] | undefined
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        observedSkills = context.injectedSkills
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const run = manager.createRun({
      conversationId: "conv_ordinary_workspace_skill_auto",
      mode: "single",
      participantAgentIds: [agent.id],
      addressedAgentIds: [agent.id],
      userMessage: {
        role: "user",
        content: "Answer without skill injection.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_ordinary",
        backendType: "local",
        rootPath: await mkdtemp(join(tmpdir(), "agent-runtime-ordinary-workspace-")),
      },
      diagnostics: {
        includeSkillDiagnostics: true,
      },
    })

    await waitForStatus(manager, run.id, "completed")

    expect(observedSkills).toEqual([])
    expect(manager.getEvents(run.id)?.some((event) =>
      event.type === "agent.skill_context.resolved"
    )).toBe(false)
  })
})
