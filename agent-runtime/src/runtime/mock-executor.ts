import { createChildLogger } from "../logger"
import { createRunEvent } from "./run-events"
import type { AgentExecutionContext, AgentExecutor, RunEvent } from "./types"

const log = createChildLogger("mock-executor")

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MockExecutor implements AgentExecutor {
  executorType = "mock" as const

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const { agent, runId, signal, task, parentAgentId, groupId, parentTaskId } = context

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Mock execution aborted before start")
      return
    }

    const started = createRunEvent(runId, "agent.started", agent.id, {
      agentName: agent.name,
      executorType: agent.executorType,
    })
    started.taskId = task?.taskId
    started.parentAgentId = parentAgentId
    started.parentTaskId = parentTaskId
    started.groupId = groupId
    yield started

    await sleep(10)
    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Mock execution aborted before message emission")
      return
    }

    const text = agent.id === "orchestrator"
      ? "Orchestrator received the task and will coordinate it in a later phase."
      : task
        ? `${agent.name} is working on task "${task.title}".`
        : `${agent.name} received the task.`

    const delta = createRunEvent(runId, "message.delta", agent.id, {
      delta: text,
    })
    delta.taskId = task?.taskId
    delta.parentAgentId = parentAgentId
    delta.parentTaskId = parentTaskId
    delta.groupId = groupId
    yield delta

    await sleep(10)
    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Mock execution aborted before completion")
      return
    }

    const completed = createRunEvent(runId, "message.completed", agent.id, {
      content: text,
    })
    completed.taskId = task?.taskId
    completed.parentAgentId = parentAgentId
    completed.parentTaskId = parentTaskId
    completed.groupId = groupId
    yield completed

    const agentCompleted = createRunEvent(runId, "agent.completed", agent.id, {
      status: "completed",
    })
    agentCompleted.taskId = task?.taskId
    agentCompleted.parentAgentId = parentAgentId
    agentCompleted.parentTaskId = parentTaskId
    agentCompleted.groupId = groupId
    yield agentCompleted

    log.info({ runId, agentId: agent.id }, "Mock execution completed")
  }
}

