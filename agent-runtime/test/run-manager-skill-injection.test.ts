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
})
