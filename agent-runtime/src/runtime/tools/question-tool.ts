import type { ToolDefinition, ToolExecutionResult } from "./types"
import { QuestionToolInputSchema, type QuestionToolInput } from "../question"

export function createQuestionTool(): ToolDefinition<QuestionToolInput, { requestId?: string }> {
  return {
    name: "question",
    displayName: "Question",
    description: [
      "Ask the user one or more structured questions before continuing.",
      "Use this when requirements, preferences, or implementation decisions are unclear.",
      "Each question must include a short title, a clear body, and selectable options.",
    ].join(" "),
    category: "interaction",
    inputSchema: QuestionToolInputSchema,
    riskLevel: "low",
    requiredPermissions: {},
    approvalPolicy: "never",
    configurableByUserAgent: false,
    deferred: true,
    async execute(): Promise<ToolExecutionResult<{ requestId?: string }>> {
      return {
        status: "failed",
        summary: "question is a deferred interaction tool and cannot execute directly",
        error: {
          code: "QUESTION_DEFERRED_TOOL",
          message: "The question tool waits for user input through the Runtime continuation flow",
        },
      }
    },
  }
}
