import { z } from "zod"
import type { OrchestratorTask, TaskExecutionResult } from "../types"
import type { ToolDefinition, ToolExecutionResult } from "./types"

const RunTaskInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  targetAgentId: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  expectedOutput: z.string().min(1),
  requiredCapabilities: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  dependsOn: z.array(z.string().min(1)).default([]),
  context: z.unknown().optional(),
  contextRef: z.string().optional(),
})

type RunTaskInput = z.infer<typeof RunTaskInputSchema>

type RunTaskModelData = {
  taskId: string
  targetAgentId: string
  groupId?: string
  parentTaskId?: string
  eventCount?: number
}

type RunTaskRuntimeData = {
  taskResult?: TaskExecutionResult
}

export function createRunTaskTool(): ToolDefinition<RunTaskInput, RunTaskModelData, RunTaskRuntimeData> {
  return {
    name: "run_task",
    description: "Create and execute one internal agent task. Only orchestrator can use this tool.",
    inputSchema: RunTaskInputSchema,
    riskLevel: "low",
    requiresApproval: false,
    allowedAgents: ["orchestrator"],
    async execute(input, context): Promise<ToolExecutionResult<RunTaskModelData, RunTaskRuntimeData>> {
      if (!context.runTask) {
        return {
          status: "failed",
          summary: "run_task is not available in this execution context",
          error: {
            code: "TOOL_RUN_TASK_UNAVAILABLE",
            message: "run_task is not available in this execution context",
          },
        }
      }

      const task: OrchestratorTask = {
        taskId: context.task?.taskId ?? input.taskId ?? `task_${input.targetAgentId}_${crypto.randomUUID().slice(0, 8)}`,
        targetAgentId: input.targetAgentId,
        title: input.title,
        instruction: input.instruction,
        expectedOutput: input.expectedOutput,
        requiredCapabilities: input.requiredCapabilities,
        riskLevel: input.riskLevel,
        dependsOn: context.task?.dependsOn ?? input.dependsOn,
      }

      const taskResult = await context.runTask(task, {
        groupId: context.groupId,
        parentTaskId: context.parentTaskId,
      })

      return {
        status: taskResult.status,
        summary: taskResult.summary,
        data: {
          taskId: taskResult.taskId,
          targetAgentId: taskResult.targetAgentId,
          groupId: taskResult.groupId,
          parentTaskId: taskResult.parentTaskId,
          eventCount: taskResult.events.length,
        },
        error: taskResult.status === "completed"
          ? undefined
          : {
              code: "RUN_TASK_FAILED",
              message: taskResult.summary,
              details: taskResult.data,
            },
        runtime: {
          taskResult,
        },
      }
    },
  }
}

