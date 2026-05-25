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
    description: [
      "Write or update the current orchestrator plan for UI rendering.",
      "This records intent and executable task candidates, but does not execute tasks.",
    ].join(" "),
    inputSchema: WritePlanInputSchema,
    riskLevel: "low",
    requiresApproval: false,
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
