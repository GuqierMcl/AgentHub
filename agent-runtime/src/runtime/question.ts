import { z } from "zod"
import type { ModelMessage } from "ai"

export const QuestionOptionSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(500),
  value: z.string().trim().min(1).max(1000).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
}).strict()
export type QuestionOption = z.infer<typeof QuestionOptionSchema>

export const QuestionItemSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  options: z.array(QuestionOptionSchema).min(1).max(12),
  allowCustom: z.boolean().default(true),
  required: z.boolean().default(true),
}).strict()
export type QuestionItem = z.infer<typeof QuestionItemSchema>

export const QuestionToolInputSchema = z.object({
  questions: z.array(QuestionItemSchema).min(1).max(10),
}).strict()
export type QuestionToolInput = z.infer<typeof QuestionToolInputSchema>

export const QuestionAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(120),
  optionId: z.string().trim().min(1).max(120).optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  custom: z.boolean().optional(),
}).strict()
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>

export const QuestionAnswerRequestSchema = z.object({
  answers: z.array(QuestionAnswerSchema).min(1).max(10),
}).strict()
export type QuestionAnswerRequest = z.infer<typeof QuestionAnswerRequestSchema>

export type NormalizedQuestionOption = Required<Pick<QuestionOption, "id" | "label">> & {
  value?: string
  description?: string
}

export type NormalizedQuestionItem = Required<Pick<QuestionItem, "id" | "title" | "body" | "allowCustom" | "required">> & {
  options: NormalizedQuestionOption[]
}

export type NormalizedQuestionAnswer = {
  questionId: string
  optionId?: string
  answer?: string
  custom: boolean
}

export type PendingQuestionToolCall = {
  toolCallId: string
  input: unknown
  messageId?: string
}

export type QuestionContinuationRequest = {
  calls: PendingQuestionToolCall[]
  resumeMessages: ModelMessage[]
}

export type ExternalQuestionRequest = {
  toolCallId: string
  input: unknown
  messageId?: string
  data?: Record<string, unknown>
}

export class RuntimeQuestionError extends Error {
  constructor(
    public code:
      | "QUESTION_NOT_FOUND"
      | "QUESTION_RUN_NOT_ACTIVE"
      | "QUESTION_INVALID_INPUT"
      | "QUESTION_ALREADY_ANSWERED",
    message: string,
    public status: 400 | 404 | 409,
    public details?: unknown
  ) {
    super(message)
    this.name = "RuntimeQuestionError"
  }
}

export function normalizeQuestionToolInput(input: QuestionToolInput): NormalizedQuestionItem[] {
  return input.questions.map((question, questionIndex) => ({
    id: question.id ?? `question_${questionIndex + 1}`,
    title: question.title,
    body: question.body,
    allowCustom: question.allowCustom,
    required: question.required,
    options: question.options.map((option, optionIndex) => ({
      id: option.id ?? `option_${optionIndex + 1}`,
      label: option.label,
      value: option.value,
      description: option.description,
    })),
  }))
}

export function normalizeQuestionAnswers(
  questions: NormalizedQuestionItem[],
  answers: QuestionAnswer[]
): NormalizedQuestionAnswer[] {
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const answerByQuestion = new Map<string, NormalizedQuestionAnswer>()

  for (const answer of answers) {
    const question = questionById.get(answer.questionId)
    if (!question) {
      throw new RuntimeQuestionError(
        "QUESTION_INVALID_INPUT",
        `Question ${answer.questionId} does not exist on this request`,
        400,
        { questionId: answer.questionId }
      )
    }

    if (answerByQuestion.has(answer.questionId)) {
      throw new RuntimeQuestionError(
        "QUESTION_INVALID_INPUT",
        `Question ${answer.questionId} was answered more than once`,
        400,
        { questionId: answer.questionId }
      )
    }

    const custom = answer.custom === true || (!answer.optionId && Boolean(answer.answer))
    if (custom) {
      if (!question.allowCustom) {
        throw new RuntimeQuestionError(
          "QUESTION_INVALID_INPUT",
          `Question ${answer.questionId} does not allow custom answers`,
          400,
          { questionId: answer.questionId }
        )
      }
      if (!answer.answer) {
        throw new RuntimeQuestionError(
          "QUESTION_INVALID_INPUT",
          `Question ${answer.questionId} requires a custom answer`,
          400,
          { questionId: answer.questionId }
        )
      }
      answerByQuestion.set(answer.questionId, {
        questionId: answer.questionId,
        answer: answer.answer,
        custom: true,
      })
      continue
    }

    if (!answer.optionId) {
      throw new RuntimeQuestionError(
        "QUESTION_INVALID_INPUT",
        `Question ${answer.questionId} requires an optionId or custom answer`,
        400,
        { questionId: answer.questionId }
      )
    }

    const option = question.options.find((candidate) => candidate.id === answer.optionId)
    if (!option) {
      throw new RuntimeQuestionError(
        "QUESTION_INVALID_INPUT",
        `Option ${answer.optionId} does not exist on question ${answer.questionId}`,
        400,
        { questionId: answer.questionId, optionId: answer.optionId }
      )
    }

    answerByQuestion.set(answer.questionId, {
      questionId: answer.questionId,
      optionId: option.id,
      answer: answer.answer ?? option.value ?? option.label,
      custom: false,
    })
  }

  for (const question of questions) {
    if (question.required && !answerByQuestion.has(question.id)) {
      throw new RuntimeQuestionError(
        "QUESTION_INVALID_INPUT",
        `Question ${question.id} requires an answer`,
        400,
        { questionId: question.id }
      )
    }
  }

  return Array.from(answerByQuestion.values())
}
