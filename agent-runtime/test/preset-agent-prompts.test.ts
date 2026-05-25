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

  test("planner is a planning advisor, not a runtime orchestrator", () => {
    const planner = presetAgents.find((agent) => agent.id === "planner")

    expect(planner?.delegationPolicy).toBe("terminal")
    expect(planner?.allowedSubagents).toEqual([])
    expect(planner?.allowedTools).not.toContain("run_task")
    expect(presetAgentSystemPrompts.planner).toContain("你不是 Orchestrator")
    expect(presetAgentSystemPrompts.planner).toContain("不要声称已经调用、委派或安排其他智能体执行任务")
  })
})
