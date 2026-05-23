import type { AgentExecutionContext, AgentExecutor, RunEvent } from "./types"
import { createRunEvent } from "./run-events"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MockExecutor implements AgentExecutor {
  executorType = "mock" as const

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const { agent, runId, signal } = context

    if (signal.aborted) {
      return
    }

    yield createRunEvent(runId, "agent.started", agent.id, {
      agentName: agent.name,
      executorType: agent.executorType,
    })

    await sleep(10)
    if (signal.aborted) {
      return
    }

    const text = agent.id === "orchestrator"
      ? "Orchestrator received the task and will coordinate it in a later phase."
      : `${agent.name} received the task.`

    yield createRunEvent(runId, "message.delta", agent.id, {
      delta: text,
    })

    await sleep(10)
    if (signal.aborted) {
      return
    }

    yield createRunEvent(runId, "message.completed", agent.id, {
      content: text,
    })

    yield createRunEvent(runId, "agent.completed", agent.id, {
      status: "completed",
    })
  }
}

