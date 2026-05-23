import type { AgentRegistry } from "../agents"
import { createChildLogger } from "../logger"
import { createRunEvent } from "./run-events"
import type {
  AgentExecutionContext,
  OrchestratorPlan,
  OrchestratorTask,
  RunEvent,
  TaskExecutionResult,
} from "./types"

const log = createChildLogger("orchestrator-executor")

function normalizeText(value: string): string {
  return value.toLowerCase().trim()
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase))
}

export class OrchestratorExecutor {
  executorType = "orchestrator" as const

  constructor(private registry: AgentRegistry) {}

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const { agent, input, runId, signal, runTask } = context

    if (!runTask) {
      throw new Error("runTask is required for orchestrator execution")
    }

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted before start")
      return
    }

    yield createRunEvent(runId, "agent.started", agent.id, {
      agentName: agent.name,
      executorType: agent.executorType,
    })

    const plan = this.buildPlan(context)
    log.info(
      {
        runId,
        agentId: agent.id,
        taskCount: plan.tasks.length,
        taskIds: plan.tasks.map((task) => task.taskId),
      },
      "Orchestrator plan created"
    )
    yield createRunEvent(runId, "orchestrator.plan.created", agent.id, {
      plan,
    })

    const taskResults: TaskExecutionResult[] = []

    for (const task of plan.tasks) {
      if (signal.aborted) {
        log.info({ runId, agentId: agent.id, taskId: task.taskId }, "Orchestrator execution aborted during task loop")
        break
      }

      log.info(
        {
          runId,
          agentId: agent.id,
          taskId: task.taskId,
          targetAgentId: task.targetAgentId,
        },
        "Running orchestrator task"
      )

      const taskResult = await runTask(task)
      taskResults.push(taskResult)

      for (const event of taskResult.events) {
        yield event
      }

      if (taskResult.status !== "completed") {
        log.warn(
          {
            runId,
            agentId: agent.id,
            taskId: task.taskId,
            targetAgentId: task.targetAgentId,
            status: taskResult.status,
          },
          "Orchestrator task did not complete"
        )
        break
      }
    }

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted before completion")
      return
    }

    const summary = this.buildSummary(taskResults, plan)
    yield createRunEvent(runId, "message.delta", agent.id, {
      delta: summary,
    })
    yield createRunEvent(runId, "message.completed", agent.id, {
      content: summary,
    })
    yield createRunEvent(runId, "agent.completed", agent.id, {
      status: "completed",
      taskCount: taskResults.length,
    })
  }

  private buildPlan(context: AgentExecutionContext): OrchestratorPlan {
    const content = context.input.userMessage.content.trim()
    const normalized = normalizeText(content)
    const tasks: OrchestratorTask[] = []

    if (this.needsExploration(normalized)) {
      tasks.push(this.buildTask("explore", content, "Gather relevant project context before answering."))
    }

    const primaryTarget = this.selectPrimaryTarget(normalized)
    if (!tasks.some((task) => task.targetAgentId === primaryTarget)) {
      tasks.push(this.buildTask(primaryTarget, content, "Handle the user request with the selected specialty."))
    }

    if (tasks.length === 0) {
      tasks.push(this.buildTask("coder", content, "Handle the request with implementation-focused reasoning."))
    }

    return {
      intent: content || "User request",
      entryAgentId: context.agent.id,
      tasks,
      summaryInstruction: "Summarize the task outcomes clearly for the user.",
    }
  }

  private buildTask(targetAgentId: string, content: string, instructionPrefix: string): OrchestratorTask {
    const targetAgent = this.registry.getAgent(targetAgentId)
    const capabilities = targetAgent?.capabilities ?? []
    const title = targetAgent?.name ? `${targetAgent.name} task` : `${targetAgentId} task`
    const expectedOutput = targetAgent?.description ?? "A useful answer for the requested task"

    return {
      taskId: `task_${targetAgentId}_${crypto.randomUUID().slice(0, 8)}`,
      targetAgentId,
      title,
      instruction: `${instructionPrefix}\n\nUser request: ${content}`,
      expectedOutput,
      requiredCapabilities: capabilities.slice(0, 3),
      riskLevel: this.inferRiskLevel(targetAgentId, content),
    }
  }

  private selectPrimaryTarget(normalized: string): string {
    if (containsAny(normalized, ["deploy", "publish", "上线", "发布"])) {
      return "deploy"
    }

    if (containsAny(normalized, ["review", "审查", "检查", "reviewer"])) {
      return "reviewer"
    }

    if (containsAny(normalized, ["doc", "documentation", "文档", "说明", "写"])) {
      return "writer"
    }

    if (containsAny(normalized, ["plan", "roadmap", "计划", "规划", "拆解"])) {
      return "planner"
    }

    if (containsAny(normalized, ["opencode", "外部", "external"])) {
      return "opencode"
    }

    return "coder"
  }

  private needsExploration(normalized: string): boolean {
    return containsAny(normalized, [
      "analyze",
      "analysis",
      "inspect",
      "check",
      "review",
      "看看",
      "分析",
      "检查",
      "调查",
      "上下文",
      "项目",
      "代码库",
      "文件",
      "结构",
    ]) || normalized.length > 80
  }

  private inferRiskLevel(targetAgentId: string, content: string): "low" | "medium" | "high" {
    if (targetAgentId === "deploy") {
      return "high"
    }

    if (containsAny(normalizeText(content), ["deploy", "publish", "上线", "发布", "write", "edit", "修改"])) {
      return "medium"
    }

    return "low"
  }

  private buildSummary(taskResults: TaskExecutionResult[], plan: OrchestratorPlan): string {
    if (taskResults.length === 0) {
      return "I reviewed the request but did not need to delegate any follow-up task."
    }

    const taskLines = taskResults
      .map((result) => `- ${result.targetAgentId}: ${result.summary}`)
      .join("\n")

    return `${plan.summaryInstruction}\n${taskLines}`
  }
}
