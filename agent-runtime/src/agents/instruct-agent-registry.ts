import type { AgentDefinition } from "./types"
import { instructAgent } from "./instruct-agents"

export class InstructAgentRegistry {
  private agents = new Map<string, AgentDefinition>()

  constructor() {
    this.agents.set(instructAgent.id, instructAgent)
  }

  getAgent(id: string): AgentDefinition | null {
    return this.agents.get(id) ?? null
  }

  listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values())
  }

  getDefaultInstructAgent(): AgentDefinition {
    return instructAgent
  }
}
