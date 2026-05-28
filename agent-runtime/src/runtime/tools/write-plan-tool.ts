import { z } from "zod"
import type { ToolDefinition, ToolExecutionResult } from "./types"

const PlanTaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
])

const WritePlanTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  targetAgentId: z.string().min(1),
  instruction: z.string().min(1),
  expectedOutput: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  dependsOn: z.array(z.string().min(1)).default([]),
  status: PlanTaskStatusSchema.default("pending"),
})

const WritePlanInputSchema = z.object({
  intent: z.string().min(1),
  summaryInstruction: z.string().min(1),
  tasks: z.array(WritePlanTaskSchema).default([]),
})

export type WritePlanInput = z.infer<typeof WritePlanInputSchema>

type WritePlanModelData = {
  plan: WritePlanInput
  taskCount: number
}

export function createWritePlanTool(): ToolDefinition<WritePlanInput, WritePlanModelData> {
  return {
    name: "write_plan",
    displayName: "Write plan",
    description: [
      "编写或更新当前编排器计划及任务状态以供 UI 渲染。",
      "这将记录意图和可执行的任务候选，但不会执行任务。",
      "当已委派任务完成、失败或取消后，应使用相同 taskId 再次调用本工具更新对应任务的 status。",
    ].join(" "),
    category: "orchestration",
    inputSchema: WritePlanInputSchema,
    riskLevel: "low",
    requiredPermissions: {},
    approvalPolicy: "never",
    configurableByUserAgent: false,
    internal: true,
    async execute(input): Promise<ToolExecutionResult<WritePlanModelData>> {
      return {
        status: "completed",
        summary: `Plan updated with ${input.tasks.length} task(s).`,
        data: {
          plan: input,
          taskCount: input.tasks.length,
        },
      }
    },
  }
}

export { WritePlanInputSchema, WritePlanTaskSchema, PlanTaskStatusSchema }
