import { describe, expect, test } from "bun:test"
import { presetAgentSystemPrompts, presetAgents } from "../src/agents"

describe("preset agent system prompts", () => {
  test("primary preset agents use centralized system prompts", () => {
    const promptMap = {
      orchestrator: presetAgentSystemPrompts.orchestrator,
      coder: presetAgentSystemPrompts.coder,
      reviewer: presetAgentSystemPrompts.reviewer,
      writer: presetAgentSystemPrompts.writer,
      planner: presetAgentSystemPrompts.planner,
    } as const

    for (const agent of presetAgents.filter((candidate) => candidate.tier === "primary" && candidate.origin === "system")) {
      const prompt = promptMap[agent.id as keyof typeof promptMap]
      expect(prompt).toBeDefined()
      expect(agent.systemPrompt).toBe(prompt)
    }
  })
})
