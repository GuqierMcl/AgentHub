import { describe, expect, test } from "bun:test"
import { buildSystemPrompt } from "../src/runtime/ai-sdk-executor"
import { formatInjectedSkillsForPrompt } from "../src/runtime/skill-prompt"
import type { AgentExecutionContext, ResolvedSkillContent } from "../src/runtime"

const skill: ResolvedSkillContent = {
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

describe("skill prompt formatting", () => {
  test("formats injected Skills as a bounded instruction block", () => {
    const block = formatInjectedSkillsForPrompt([skill])

    expect(block).toContain("<AgentHubSkillInstructions>")
    expect(block).toContain('id="global:agents:review"')
    expect(block).toContain("Always inspect tests before claiming completion.")
    expect(block).toContain("</AgentHubSkillInstructions>")
  })

  test("injects Skills into AI SDK system prompt", () => {
    const context = {
      runId: "run_skill_prompt",
      input: {
        conversationId: "conv_skill_prompt",
        mode: "single",
        participantAgentIds: ["coder"],
        addressedAgentIds: [],
        userMessage: { role: "user", content: "Review this." },
        history: [],
      },
      agent: {
        id: "coder",
        name: "Coder",
        description: "Writes code",
        tier: "primary",
        origin: "system",
        visibility: "visible",
        entryPolicy: "callable",
        delegationPolicy: "can-delegate",
        executorType: "ai-sdk",
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
        readonly: true,
      },
      injectedSkills: [skill],
      signal: new AbortController().signal,
    } satisfies AgentExecutionContext

    const prompt = buildSystemPrompt(context)
    expect(prompt).toContain("Always inspect tests before claiming completion.")
  })
})
