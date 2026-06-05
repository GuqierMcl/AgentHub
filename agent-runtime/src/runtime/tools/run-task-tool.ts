import { z } from "zod"
import { TaskLockPathsSchema, type OrchestratorTask, type TaskExecutionResult } from "../types"
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
  lockPaths: TaskLockPathsSchema,
  context: z.unknown().optional(),
  contextRef: z.string().optional(),
})

type RunTaskInput = z.infer<typeof RunTaskInputSchema>

type RunTaskModelData = {
  taskId: string
  targetAgentId: string
  lockPaths: string[]
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
    displayName: "Run task",
    description: "Create and execute one internal agent task. Only orchestrator can use this tool.",
    category: "orchestration",
    inputSchema: RunTaskInputSchema,
    riskLevel: "low",
    requiredPermissions: {},
    approvalPolicy: "never",
    configurableByUserAgent: false,
    internal: true,
    async execute(input, context): Promise<ToolExecutionResult<RunTaskModelData, RunTaskRuntimeData>> {
      const executeTask = context.executeTask ?? context.runTask
      if (!executeTask) {
        return {
          status: "failed",
          summary: "run_task is not available in this execution context",
          error: {
            code: "TOOL_RUN_TASK_UNAVAILABLE",
            message: "run_task is not available in this execution context",
          },
        }
      }

      const lockPaths = context.task?.lockPaths ?? input.lockPaths
      const task: OrchestratorTask = {
        taskId: context.task?.taskId ?? input.taskId ?? `task_${input.targetAgentId}_${crypto.randomUUID().slice(0, 8)}`,
        targetAgentId: input.targetAgentId,
        title: input.title,
        instruction: input.instruction,
        expectedOutput: input.expectedOutput,
        requiredCapabilities: input.requiredCapabilities,
        riskLevel: input.riskLevel,
        dependsOn: context.task?.dependsOn ?? input.dependsOn,
        lockPaths,
      }

      const taskResult = await executeTask(task, {
        groupId: context.groupId,
        parentTaskId: context.parentTaskId,
      })

      return {
        status: taskResult.status,
        summary: taskResult.summary,
        data: {
          taskId: taskResult.taskId,
          targetAgentId: taskResult.targetAgentId,
          lockPaths: taskResult.lockPaths ?? lockPaths,
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
