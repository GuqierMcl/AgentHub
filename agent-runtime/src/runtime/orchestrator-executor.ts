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

type TaskState = {
  task: OrchestratorTask
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  result?: TaskExecutionResult
  blockedBy?: string[]
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim()
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase))
}

function hasSequentialCue(normalized: string): boolean {
  return containsAny(normalized, [
    "先分析",
    "先做",
    "先进行",
    "先完成",
    "然后",
    "再",
    "之后",
    "最后",
    "first",
    "then",
    "after",
    "before",
    "再实现",
    "再做",
  ])
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
    this.validatePlan(plan)
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

    const state = new Map<string, TaskState>()
    for (const task of plan.tasks) {
      state.set(task.taskId, { task, status: "pending" })
    }

    const results: TaskExecutionResult[] = []

    while (true) {
      if (signal.aborted) {
        log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted during scheduling")
        break
      }

      const readyTasks = this.findReadyTasks(state)
      if (readyTasks.length > 0) {
        const groupId = `task_group_${crypto.randomUUID().slice(0, 8)}`
        yield createRunEvent(runId, "task.group.started", agent.id, {
          groupId,
          taskIds: readyTasks.map((task) => task.taskId),
          taskCount: readyTasks.length,
        })

        for (const task of readyTasks) {
          const taskState = state.get(task.taskId)
          if (taskState) {
            taskState.status = "running"
          }
        }

        const batchResults = await Promise.all(
          readyTasks.map((task) => runTask(task, {
            groupId,
            parentTaskId: task.dependsOn[0],
          }))
        )

        for (const taskResult of batchResults) {
          results.push(taskResult)
          const taskState = state.get(taskResult.taskId)
          if (taskState) {
            taskState.status = taskResult.status
            taskState.result = taskResult
          }
        }

        const completedCount = batchResults.filter((result) => result.status === "completed").length
        const failedCount = batchResults.filter((result) => result.status === "failed").length
        const cancelledCount = batchResults.filter((result) => result.status === "cancelled").length

        yield createRunEvent(runId, "task.group.completed", agent.id, {
          groupId,
          taskIds: readyTasks.map((task) => task.taskId),
          completedCount,
          failedCount,
          cancelledCount,
          taskCount: readyTasks.length,
        })
        continue
      }

      const pendingTasks = Array.from(state.values()).filter((taskState) => taskState.status === "pending")
      if (pendingTasks.length === 0) {
        break
      }

      const blockedTasks = pendingTasks.filter((taskState) => this.isBlocked(taskState.task, state))
      if (blockedTasks.length === 0) {
        throw new Error("Orchestrator plan contains a dependency cycle")
      }

      for (const taskState of blockedTasks) {
        const blockedBy = this.blockingDependencies(taskState.task, state)
        taskState.status = "failed"
        taskState.blockedBy = blockedBy

        const blockedResult = this.createBlockedTaskResult({
          runId,
          orchestratorId: agent.id,
          task: taskState.task,
          blockedBy,
        })
        taskState.result = blockedResult
        results.push(blockedResult)
        yield blockedResult.events[0]
      }
    }

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted before completion")
      return
    }

    const summary = this.buildSummary(results, plan)
    yield createRunEvent(runId, "message.delta", agent.id, {
      delta: summary,
    })
    yield createRunEvent(runId, "message.completed", agent.id, {
      content: summary,
    })
    yield createRunEvent(runId, "agent.completed", agent.id, {
      status: "completed",
      taskCount: results.length,
    })
  }

  private buildPlan(context: AgentExecutionContext): OrchestratorPlan {
    const content = context.input.userMessage.content.trim()
    const normalized = normalizeText(content)
    const wantsAnalysis = containsAny(normalized, [
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
    const wantsImplementation = containsAny(normalized, [
      "implement",
      "implementation",
      "code",
      "modify",
      "edit",
      "实现",
      "修改",
      "修复",
      "开发",
      "编写",
    ])
    const wantsReview = containsAny(normalized, [
      "review",
      "审查",
      "检查",
      "验收",
      "审阅",
    ])
    const wantsDocs = containsAny(normalized, [
      "doc",
      "documentation",
      "文档",
      "说明",
      "写",
      "总结",
    ])
    const wantsPlanning = containsAny(normalized, [
      "plan",
      "roadmap",
      "计划",
      "规划",
      "拆解",
    ])
    const wantsDeploy = containsAny(normalized, [
      "deploy",
      "publish",
      "上线",
      "发布",
    ])
    const sequentialCue = hasSequentialCue(normalized)

    const tasks: OrchestratorTask[] = []

    const exploreTask = wantsAnalysis
      ? this.buildTask("explore", content, "Gather relevant project context before answering.")
      : null
    const coderTask = wantsImplementation
      ? this.buildTask("coder", content, "Handle the user request with implementation-focused reasoning.")
      : null
    const reviewerTask = wantsReview
      ? this.buildTask("reviewer", content, "Check correctness, regressions, and missing verification.")
      : null
    const writerTask = wantsDocs
      ? this.buildTask("writer", content, "Draft concise user-facing documentation or explanation.")
      : null
    const plannerTask = wantsPlanning
      ? this.buildTask("planner", content, "Break the request into a scoped execution plan.")
      : null
    const deployTask = wantsDeploy
      ? this.buildTask("deploy", content, "Prepare a safe deployment or publish workflow.")
      : null

    if (exploreTask) {
      tasks.push(exploreTask)
    }
    if (coderTask) {
      tasks.push(coderTask)
    }
    if (reviewerTask) {
      tasks.push(reviewerTask)
    }
    if (writerTask) {
      tasks.push(writerTask)
    }
    if (plannerTask) {
      tasks.push(plannerTask)
    }
    if (deployTask) {
      tasks.push(deployTask)
    }

    if (tasks.length === 0) {
      tasks.push(this.buildTask("coder", content, "Handle the request with implementation-focused reasoning."))
    }

    if (sequentialCue && exploreTask && coderTask) {
      coderTask.dependsOn = [exploreTask.taskId]
    }

    if (sequentialCue && coderTask && reviewerTask) {
      reviewerTask.dependsOn = [coderTask.taskId]
    }

    if (deployTask && coderTask) {
      deployTask.dependsOn = [coderTask.taskId]
    }

    if (sequentialCue && exploreTask && plannerTask) {
      plannerTask.dependsOn = [exploreTask.taskId]
    }

    if (sequentialCue && coderTask && writerTask) {
      writerTask.dependsOn = [coderTask.taskId]
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
      dependsOn: [],
    }
  }

  private validatePlan(plan: OrchestratorPlan): void {
    const taskMap = new Map<string, OrchestratorTask>()

    for (const task of plan.tasks) {
      if (taskMap.has(task.taskId)) {
        throw new Error(`Duplicate orchestrator task id: ${task.taskId}`)
      }
      taskMap.set(task.taskId, task)
    }

    for (const task of plan.tasks) {
      for (const dependencyId of task.dependsOn) {
        if (!taskMap.has(dependencyId)) {
          throw new Error(`Task ${task.taskId} depends on missing task ${dependencyId}`)
        }
        if (dependencyId === task.taskId) {
          throw new Error(`Task ${task.taskId} cannot depend on itself`)
        }
      }
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) {
        return
      }

      if (visiting.has(taskId)) {
        throw new Error(`Task dependency cycle detected at ${taskId}`)
      }

      visiting.add(taskId)
      const task = taskMap.get(taskId)
      if (!task) {
        return
      }

      for (const dependencyId of task.dependsOn) {
        visit(dependencyId)
      }

      visiting.delete(taskId)
      visited.add(taskId)
    }

    for (const task of plan.tasks) {
      visit(task.taskId)
    }
  }

  private findReadyTasks(state: Map<string, TaskState>): OrchestratorTask[] {
    return Array.from(state.values())
      .filter((taskState) => taskState.status === "pending")
      .filter((taskState) => taskState.task.dependsOn.every((dependencyId) => {
        const dependencyState = state.get(dependencyId)
        return dependencyState?.status === "completed"
      }))
      .map((taskState) => taskState.task)
  }

  private isBlocked(task: OrchestratorTask, state: Map<string, TaskState>): boolean {
    return task.dependsOn.some((dependencyId) => {
      const dependencyState = state.get(dependencyId)
      return !dependencyState || dependencyState.status === "failed" || dependencyState.status === "cancelled"
    })
  }

  private blockingDependencies(task: OrchestratorTask, state: Map<string, TaskState>): string[] {
    return task.dependsOn.filter((dependencyId) => {
      const dependencyState = state.get(dependencyId)
      return !dependencyState || dependencyState.status === "failed" || dependencyState.status === "cancelled"
    })
  }

  private createBlockedTaskResult(options: {
    runId: string
    orchestratorId: string
    task: OrchestratorTask
    blockedBy: string[]
  }): TaskExecutionResult {
    const { runId, orchestratorId, task, blockedBy } = options
    const event = createRunEvent(runId, "task.failed", orchestratorId, {
      taskId: task.taskId,
      targetAgentId: task.targetAgentId,
      dependsOn: task.dependsOn,
      code: "TASK_DEPENDENCY_FAILED",
      message: `Task ${task.taskId} is blocked by failed dependency`,
      details: {
        blockedBy,
      },
    })
    event.taskId = task.taskId
    event.groupId = `blocked_${task.taskId}`
    event.parentTaskId = blockedBy[0]
    return {
      taskId: task.taskId,
      targetAgentId: task.targetAgentId,
      status: "failed",
      summary: `Blocked by failed dependency: ${blockedBy.join(", ")}`,
      dependsOn: task.dependsOn,
      parentTaskId: blockedBy[0],
      groupId: event.groupId,
      data: {
        blockedBy,
      },
      events: [event],
    }
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
      .map((result) => `- ${result.targetAgentId} [${result.status}]: ${result.summary}`)
      .join("\n")

    return `${plan.summaryInstruction}\n${taskLines}`
  }
}
