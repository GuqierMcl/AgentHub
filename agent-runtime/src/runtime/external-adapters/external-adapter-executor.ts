import { createRunEvent } from "../run-events"
import type { AgentExecutionContext, AgentExecutor, RunEvent } from "../types"
import { DefaultExternalAdapterRegistry } from "./registry"
import {
  ExternalAdapterError,
  type ExternalAdapterExecutorDependencies,
  type ExternalAdapterRegistry,
  type ExternalSessionScope,
} from "./types"

export class ExternalAdapterExecutor implements AgentExecutor {
  executorType = "external-adapter" as const

  private registry: ExternalAdapterRegistry

  constructor(dependencies: ExternalAdapterExecutorDependencies = {}) {
    this.registry = dependencies.registry ?? new DefaultExternalAdapterRegistry()
  }

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const external = context.agent.external
    if (!external) {
      throw new ExternalAdapterError(
        "ADAPTER_CONFIG_MISSING",
        `Agent ${context.agent.id} is missing external adapter configuration`,
        { agentId: context.agent.id }
      )
    }

    const adapter = this.registry.getAdapter(external.provider)
    if (!adapter) {
      throw new ExternalAdapterError(
        "ADAPTER_NOT_AVAILABLE",
        `External adapter ${external.provider} is not available`,
        { provider: external.provider, agentId: context.agent.id }
      )
    }

    const workspace = context.input.workspace
    if (!workspace || (external.workingDirectoryPolicy === "runtime-workspace" && !context.workspaceService?.getHandle())) {
      throw new ExternalAdapterError(
        "ADAPTER_WORKSPACE_REQUIRED",
        `External adapter ${external.provider} requires a bound workspace`,
        { provider: external.provider, agentId: context.agent.id }
      )
    }

    const scope: ExternalSessionScope = context.task ? "delegated-task" : "conversation-visible"
    const adapterContext = {
      ...context,
      agent: {
        ...context.agent,
        external,
      },
      scope,
      workspace,
    }

    try {
      for await (const event of adapter.execute(adapterContext)) {
        yield event
      }
    } catch (error) {
      if (error instanceof ExternalAdapterError) {
        throw error
      }

      const failed = createRunEvent(context.runId, "agent.completed", context.agent.id, {
        status: "failed",
        code: "ADAPTER_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : "External adapter execution failed",
      })
      failed.taskId = context.task?.taskId
      failed.parentAgentId = context.parentAgentId
      failed.parentTaskId = context.parentTaskId
      failed.groupId = context.groupId
      yield failed

      throw new ExternalAdapterError(
        "ADAPTER_EXECUTION_FAILED",
        error instanceof Error ? error.message : "External adapter execution failed",
        { provider: external.provider, agentId: context.agent.id }
      )
    }
  }
}
