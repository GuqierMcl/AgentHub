import type { AgentRegistry } from "../agents"
import type { AgentDefinition } from "../agents"
import type { EntryResolution, RunInput } from "./types"

export class RunInputValidationError extends Error {
  code: "RUN_INVALID_PARTICIPANTS" | "RUN_INVALID_ENTRY_AGENT"
  details?: unknown

  constructor(
    code: "RUN_INVALID_PARTICIPANTS" | "RUN_INVALID_ENTRY_AGENT",
    message: string,
    details?: unknown
  ) {
    super(message)
    this.name = "RunInputValidationError"
    this.code = code
    this.details = details
  }
}

export class EntryResolver {
  constructor(private registry: AgentRegistry) {}

  resolve(input: RunInput): EntryResolution {
    const participantIds = this.unique(input.participantAgentIds)
    const addressedIds = this.unique(input.addressedAgentIds ?? [])

    if (participantIds.length !== input.participantAgentIds.length) {
      throw new RunInputValidationError(
        "RUN_INVALID_PARTICIPANTS",
        "Conversation participants must be unique"
      )
    }

    if (addressedIds.length !== (input.addressedAgentIds ?? []).length) {
      throw new RunInputValidationError(
        "RUN_INVALID_ENTRY_AGENT",
        "Addressed agents must be unique"
      )
    }

    if (addressedIds.length > 1) {
      throw new RunInputValidationError(
        "RUN_INVALID_ENTRY_AGENT",
        "Only one addressed agent is supported in this phase"
      )
    }

    const participants = participantIds.map((agentId) =>
      this.requireConversationParticipant(agentId)
    )

    if (input.mode === "single") {
      return this.resolveSingle(input, participants, addressedIds)
    }

    return this.resolveGroup(participants, addressedIds)
  }

  private resolveSingle(
    input: RunInput,
    participants: AgentDefinition[],
    addressedIds: string[]
  ): EntryResolution {
    if (participants.length !== 1) {
      throw new RunInputValidationError(
        "RUN_INVALID_PARTICIPANTS",
        "Single chat must contain exactly one primary callable agent"
      )
    }

    const participant = participants[0]
    if (participant.id === "orchestrator") {
      throw new RunInputValidationError(
        "RUN_INVALID_PARTICIPANTS",
        "Single chat cannot use orchestrator as the participant"
      )
    }

    if (addressedIds.length > 0 && addressedIds[0] !== participant.id) {
      throw new RunInputValidationError(
        "RUN_INVALID_ENTRY_AGENT",
        "Single chat can only address its participant",
        { addressedAgentIds: input.addressedAgentIds }
      )
    }

    return {
      entryAgentIds: [participant.id],
      entryReason: "single_participant",
      entryAgents: [participant],
    }
  }

  private resolveGroup(
    participants: AgentDefinition[],
    addressedIds: string[]
  ): EntryResolution {
    const participantIds = new Set(participants.map((agent) => agent.id))
    const orchestrator = this.registry.getAgent("orchestrator")

    if (!orchestrator || !participantIds.has("orchestrator")) {
      throw new RunInputValidationError(
        "RUN_INVALID_PARTICIPANTS",
        "Group chat must include orchestrator"
      )
    }

    if (addressedIds.length === 0) {
      this.requireGroupAddressableAgent(orchestrator.id)
      return {
        entryAgentIds: [orchestrator.id],
        entryReason: "group_default_orchestrator",
        entryAgents: [orchestrator],
      }
    }

    const addressedAgentId = addressedIds[0]
    if (!participantIds.has(addressedAgentId)) {
      throw new RunInputValidationError(
        "RUN_INVALID_ENTRY_AGENT",
        "Addressed agent must belong to the group chat",
        { addressedAgentId }
      )
    }

    const addressedAgent = this.requireGroupAddressableAgent(addressedAgentId)
    return {
      entryAgentIds: [addressedAgent.id],
      entryReason: "group_addressed_agent",
      entryAgents: [addressedAgent],
    }
  }

  private requireConversationParticipant(agentId: string): AgentDefinition {
    const agent = this.registry.getAgent(agentId)
    if (!agent) {
      throw new RunInputValidationError(
        "RUN_INVALID_PARTICIPANTS",
        `Participant agent ${agentId} does not exist`
      )
    }

    if (
      !agent.enabled ||
      agent.tier !== "primary" ||
      agent.visibility !== "visible" ||
      agent.entryPolicy === "not-callable"
    ) {
      throw new RunInputValidationError(
        "RUN_INVALID_PARTICIPANTS",
        `Participant agent ${agentId} is not a visible enabled primary agent`
      )
    }

    return agent
  }

  private requireGroupAddressableAgent(agentId: string): AgentDefinition {
    const agent = this.registry.getAgent(agentId)
    if (
      !agent ||
      !agent.enabled ||
      agent.tier !== "primary" ||
      agent.visibility !== "visible" ||
      (agent.entryPolicy !== "callable" && agent.entryPolicy !== "default")
    ) {
      throw new RunInputValidationError(
        "RUN_INVALID_ENTRY_AGENT",
        `Agent ${agentId} cannot be used as a group entry agent`
      )
    }

    return agent
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values))
  }
}

