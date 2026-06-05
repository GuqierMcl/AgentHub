import type {
  InstructLastPromptResponse,
  InstructQuestionAnswerBody,
  InstructRunCreateResponse,
  InstructRunInput,
  InstructRunRecord,
} from "../types"

type ErrorBody = {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

export class InstructRunRequestError extends Error {
  code?: string
  details?: unknown

  constructor(message: string, code?: string, details?: unknown) {
    super(message)
    this.name = "InstructRunRequestError"
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ErrorBody
    const message = body.error?.message ?? `请求失败 (${response.status})`
    throw new InstructRunRequestError(message, body.error?.code, body.error?.details)
  }

  return response.json()
}

export const instructRunsApi = {
  lastPrompt(): Promise<InstructLastPromptResponse> {
    return request("/api/instruct-runs/last-prompt")
  },

  create(input: InstructRunInput): Promise<InstructRunCreateResponse> {
    return request("/api/instruct-runs", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  get(runId: string): Promise<InstructRunRecord> {
    return request(`/api/instruct-runs/${encodeURIComponent(runId)}`)
  },

  answerQuestion(
    runId: string,
    requestId: string,
    body: InstructQuestionAnswerBody
  ): Promise<unknown> {
    return request(
      `/api/instruct-runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/answer`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    )
  },

  cancel(runId: string): Promise<unknown> {
    return request(`/api/instruct-runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    })
  },

  eventsUrl(runId: string): string {
    return `/api/instruct-runs/${encodeURIComponent(runId)}/events`
  },
}
