import { createRunEvent } from "../run-events"
import type { RunEvent } from "../types"
import type { ExternalAdapterContext, ExternalAgentAdapter, ExternalAdapterPrompt } from "./types"
import type { OpenCodeClient } from "./opencode-client"
import { createChildLogger } from "../../logger"
import { createDefaultOpenCodeClient } from "./opencode-real-client"

const log = createChildLogger("opencode-adapter")

export class OpenCodeAdapter implements ExternalAgentAdapter {
  provider = "opencode" as const

  constructor(private client: OpenCodeClient = createDefaultOpenCodeClient()) {}

  async *execute(context: ExternalAdapterContext): AsyncIterable<RunEvent> {
    const sessionHint = context.input.externalSessionHints?.find((hint) => {
      return hint.provider === this.provider &&
        hint.agentId === context.agent.id &&
        hint.scope === context.scope &&
        (!hint.workspaceId || hint.workspaceId === context.workspace.workspaceId) &&
        (!context.task?.taskId || hint.taskId === undefined || hint.taskId === context.task.taskId)
    })

    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        workspaceId: context.workspace.workspaceId,
        workspaceRootPath: context.workspace.rootPath,
        taskId: context.task?.taskId,
        parentAgentId: context.parentAgentId,
        groupId: context.groupId,
        hasSessionHint: Boolean(sessionHint),
        hintedProviderSessionId: sessionHint?.providerSessionId,
      },
      "OpenCode adapter execution starting"
    )
    const session = await this.client.ensureSession({
      runId: context.runId,
      conversationId: context.input.conversationId,
      agentId: context.agent.id,
      scope: context.scope,
      workspaceId: context.workspace.workspaceId,
      workspaceRootPath: context.workspace.rootPath,
      taskId: context.task?.taskId,
      providerSessionId: sessionHint?.providerSessionId,
      handoffSummary: sessionHint?.handoffSummary,
    })
    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        workspaceId: context.workspace.workspaceId,
        taskId: context.task?.taskId,
        providerSessionId: session.providerSessionId,
        reusedHint: Boolean(sessionHint && sessionHint.providerSessionId === session.providerSessionId),
      },
      "OpenCode adapter session ready"
    )

    const started = createRunEvent(context.runId, "agent.started", context.agent.id, {
      agentName: context.agent.name,
      executorType: context.agent.executorType,
      externalProvider: this.provider,
      externalSession: session,
    })
    started.taskId = context.task?.taskId
    started.parentAgentId = context.parentAgentId
    started.parentTaskId = context.parentTaskId
    started.groupId = context.groupId
    yield started

    const prompt = this.buildPrompt(context)
    const messageId = context.createMessageId?.()
    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        taskId: context.task?.taskId,
        providerSessionId: session.providerSessionId,
        messageId,
        promptLength: prompt.content.length,
      },
      "OpenCode adapter prompt dispatching"
    )

    for await (const chunk of this.client.streamPrompt({
      session,
      prompt,
      signal: context.signal,
    })) {
      if (context.signal.aborted) {
        log.info(
          {
            externalProvider: this.provider,
            runId: context.runId,
            conversationId: context.input.conversationId,
            agentId: context.agent.id,
            scope: context.scope,
            taskId: context.task?.taskId,
            providerSessionId: session.providerSessionId,
          },
          "OpenCode adapter execution aborted during prompt stream"
        )
        return
      }

      const event = chunk.type === "message.delta"
        ? createRunEvent(context.runId, "message.delta", context.agent.id, {
            delta: chunk.delta,
          })
        : createRunEvent(context.runId, "message.completed", context.agent.id, {
            content: chunk.content,
            ...(chunk.externalModel ? { externalModel: chunk.externalModel } : {}),
          })

      event.messageId = messageId
      event.taskId = context.task?.taskId
      event.parentAgentId = context.parentAgentId
      event.parentTaskId = context.parentTaskId
      event.groupId = context.groupId
      yield event
    }

    if (context.signal.aborted) {
      log.info(
        {
          externalProvider: this.provider,
          runId: context.runId,
          conversationId: context.input.conversationId,
          agentId: context.agent.id,
          scope: context.scope,
          taskId: context.task?.taskId,
          providerSessionId: session.providerSessionId,
        },
        "OpenCode adapter execution aborted after prompt stream"
      )
      return
    }

    const completed = createRunEvent(context.runId, "agent.completed", context.agent.id, {
      status: "completed",
      externalProvider: this.provider,
      externalSession: session,
    })
    completed.taskId = context.task?.taskId
    completed.parentAgentId = context.parentAgentId
    completed.parentTaskId = context.parentTaskId
    completed.groupId = context.groupId
    yield completed
    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        taskId: context.task?.taskId,
        providerSessionId: session.providerSessionId,
      },
      "OpenCode adapter execution completed"
    )
  }

  private buildPrompt(context: ExternalAdapterContext): ExternalAdapterPrompt {
    if (context.task) {
      return {
        scope: context.scope,
        task: context.task,
        content: [
          `Task title: ${context.task.title}`,
          `Task instruction: ${context.task.instruction}`,
          `Expected output: ${context.task.expectedOutput}`,
          `Risk level: ${context.task.riskLevel}`,
          `User request: ${context.input.userMessage.content}`,
        ].join("\n"),
      }
    }

    return {
      scope: context.scope,
      content: context.input.userMessage.content,
    }
  }
}
