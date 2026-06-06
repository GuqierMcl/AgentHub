import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { WorkbenchTimelineItem } from "@/features/workbench/types"

import { instructRunsApi, InstructRunRequestError } from "../api/instruct-runs"
import { InstructStreamManager } from "../runtime/instruct-stream-manager"
import {
  applyInstructRuntimeEventToTimeline,
  createLocalRunStatusItem,
  createLocalUserTimelineItem,
  extractSavedAgent,
} from "../runtime/instruct-timeline"
import type {
  InstructConnectionStatus,
  InstructHistoryMessage,
  InstructRunEvent,
  InstructQuestionAnswerBody,
  InstructRunStatus,
  InstructSavedAgent,
} from "../types"

const TEMPLATE_PROMPT = `我想创建一个新的智能体，请根据下面信息帮我补全配置：

1. 智能体名称：
2. 主要职责：
3. 希望它怎么回答用户：
4. 需要使用哪些工具能力：如果不确定，请询问我
5. 需要调用哪些子智能体：如果不确定，请询问我
6. 文件权限需求：不需要 / 只读 / 可写，如果不确定，请询问我
7. 其他偏好：`

export function useInstructAgentSession() {
  const conversationId = useMemo(() => `instruct-${crypto.randomUUID()}`, [])
  const streamManagerRef = useRef(new InstructStreamManager())
  const receivedEventIdsRef = useRef<Set<string>>(new Set())
  const hasUserEditedDraftRef = useRef(false)
  const activeRunIdRef = useRef<string | null>(null)
  const runStatusRef = useRef<InstructRunStatus | "idle" | "submitted">("idle")
  const [draft, setDraftState] = useState("")
  const [timelineItems, setTimelineItems] = useState<WorkbenchTimelineItem[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<InstructRunStatus | "idle" | "submitted">("idle")
  const [connectionStatus, setConnectionStatus] = useState<InstructConnectionStatus>("idle")
  const [savedAgent, setSavedAgent] = useState<InstructSavedAgent | null>(null)

  const updateActiveRunId = useCallback((nextRunId: string | null) => {
    activeRunIdRef.current = nextRunId
    setActiveRunId(nextRunId)
  }, [])

  const updateRunStatus = useCallback((nextStatus: InstructRunStatus | "idle" | "submitted") => {
    runStatusRef.current = nextStatus
    setRunStatus(nextStatus)
  }, [])

  const appendLocalRunStatusItem = useCallback((
    status: InstructRunStatus,
    message: string,
    code?: string
  ) => {
    setTimelineItems((current) => [
      ...current,
      createLocalRunStatusItem(message, code, status === "failed" ? "failed" : "cancelled"),
    ])
  }, [])

  const loadInitialDraft = useCallback(async () => {
    try {
      const result = await instructRunsApi.lastPrompt()
      if (!hasUserEditedDraftRef.current) {
        setDraftState(result.prompt?.trim() || TEMPLATE_PROMPT)
      }
    } catch {
      if (!hasUserEditedDraftRef.current) {
        setDraftState(TEMPLATE_PROMPT)
      }
    }
  }, [])

  useEffect(() => {
    const cancelled = { current: false }
    const streamManager = streamManagerRef.current
    instructRunsApi.lastPrompt().then((result) => {
      if (cancelled.current || hasUserEditedDraftRef.current) return
      setDraftState(result.prompt?.trim() || TEMPLATE_PROMPT)
    }).catch(() => {
      if (cancelled.current || hasUserEditedDraftRef.current) return
      setDraftState(TEMPLATE_PROMPT)
    })
    return () => {
      cancelled.current = true
      streamManager.disconnect()
    }
  }, [])

  const setDraft = useCallback((value: string) => {
    hasUserEditedDraftRef.current = true
    setDraftState(value)
  }, [])

  const handleRuntimeEvents = useCallback((events: InstructRunEvent[]) => {
    const nextEvents = events.filter((event) => {
      if (receivedEventIdsRef.current.has(event.id)) {
        return false
      }
      receivedEventIdsRef.current.add(event.id)
      return true
    })

    if (nextEvents.length === 0) {
      return
    }

    setTimelineItems((current) =>
      nextEvents.reduce(
        (items, event) => applyInstructRuntimeEventToTimeline(items, event),
        current
      )
    )

    const nextStatus = getRunStatusForEvents(nextEvents)
    if (nextStatus) {
      updateRunStatus(nextStatus)
    }

    for (const event of nextEvents) {
      const nextSavedAgent = extractSavedAgent(event)
      if (nextSavedAgent) {
        setSavedAgent(nextSavedAgent)
      }
    }
  }, [updateRunStatus])

  const submit = useCallback(async (content: string) => {
    const normalizedContent = content.trim()
    if (!normalizedContent) {
      return
    }

    const history = buildHistoryFromTimeline(timelineItems)
    const userItem = createLocalUserTimelineItem(normalizedContent)
    setTimelineItems((current) => [...current, userItem])
    setDraftState("")
    setSavedAgent(null)
    updateRunStatus("submitted")
    setConnectionStatus("connecting")
    receivedEventIdsRef.current = new Set()

    try {
      const response = await instructRunsApi.create({
        conversationId,
        userMessage: {
          role: "user",
          content: normalizedContent,
        },
        ...(history.length > 0 ? { history } : {}),
      })

      updateActiveRunId(response.runId)
      updateRunStatus(response.status)

      streamManagerRef.current.connect(response.runId, {
        onOpen: () => {
          setConnectionStatus("connected")
        },
        onError: () => {
          setConnectionStatus((current) =>
            isTerminalRunStatus(runStatusRef.current) ? current : "error"
          )
        },
        getRunStatus: () => runStatusRef.current,
        onEvents: handleRuntimeEvents,
        onTerminal: (status) => {
          updateRunStatus(status)
          setConnectionStatus("disconnected")
          updateActiveRunId(null)
        },
      })
    } catch (error) {
      const requestError = error instanceof InstructRunRequestError ? error : null
      updateActiveRunId(null)
      updateRunStatus("failed")
      setConnectionStatus("error")
      appendLocalRunStatusItem(
        "failed",
        requestError?.message ?? "创建智能体对话启动失败",
        requestError?.code
      )
    }
  }, [appendLocalRunStatusItem, conversationId, handleRuntimeEvents, timelineItems, updateActiveRunId, updateRunStatus])

  const answerQuestion = useCallback(async (
    runId: string,
    requestId: string,
    body: InstructQuestionAnswerBody
  ) => {
    await instructRunsApi.answerQuestion(runId, requestId, body)
  }, [])

  const cancel = useCallback(async (options?: { fallbackToChat?: boolean }) => {
    const targetRunId = activeRunIdRef.current
    if (!targetRunId) {
      return
    }

    try {
      await instructRunsApi.cancel(targetRunId)
      streamManagerRef.current.disconnect()
      updateActiveRunId(null)
      updateRunStatus("cancelled")
      setConnectionStatus("disconnected")
      appendLocalRunStatusItem("cancelled", "已取消本轮创建")
    } catch (error) {
      if (options?.fallbackToChat) {
        streamManagerRef.current.disconnect()
        updateActiveRunId(null)
        updateRunStatus("cancelled")
        setConnectionStatus("disconnected")
        appendLocalRunStatusItem("cancelled", "无法确认原 Run 状态，已在本地跳过本轮问题等待")
        return
      }
      throw error
    }
  }, [appendLocalRunStatusItem, updateActiveRunId, updateRunStatus])

  const reset = useCallback(async () => {
    streamManagerRef.current.disconnect()
    receivedEventIdsRef.current = new Set()
    hasUserEditedDraftRef.current = false
    setTimelineItems([])
    updateActiveRunId(null)
    updateRunStatus("idle")
    setConnectionStatus("idle")
    setSavedAgent(null)
    setDraftState("")
    await loadInitialDraft()
  }, [loadInitialDraft, updateActiveRunId, updateRunStatus])

  return useMemo(() => ({
    conversationId,
    templatePrompt: TEMPLATE_PROMPT,
    draft,
    timelineItems,
    activeRunId,
    runStatus,
    connectionStatus,
    savedAgent,
    setDraft,
    submit,
    answerQuestion,
    cancel,
    reset,
  }), [
    activeRunId,
    answerQuestion,
    cancel,
    connectionStatus,
    conversationId,
    draft,
    reset,
    runStatus,
    savedAgent,
    setDraft,
    submit,
    timelineItems,
  ])
}

function buildHistoryFromTimeline(items: WorkbenchTimelineItem[]): InstructHistoryMessage[] {
  return items.flatMap((item) => {
    if (item.kind !== "chat_message") {
      return []
    }

    const content = item.text.trim()
    if (!content) {
      return []
    }

    if (item.role !== "user" && item.role !== "assistant") {
      return []
    }

    return [{
      role: item.role,
      content,
    }]
  })
}

function getRunStatusForEvent(
  type: string
): InstructRunStatus | null {
  switch (type) {
    case "run.started":
      return "running"
    case "run.completed":
      return "completed"
    case "run.failed":
      return "failed"
    case "run.cancelled":
      return "cancelled"
    case "question.requested":
      return "waiting_input"
    case "question.answered":
    case "question.cancelled":
      return "running"
    default:
      return null
  }
}

function getRunStatusForEvents(
  events: Array<{ type: string }>
): InstructRunStatus | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const status = getRunStatusForEvent(events[index]?.type ?? "")
    if (status) {
      return status
    }
  }
  return null
}

function isTerminalRunStatus(status: InstructRunStatus | "idle" | "submitted"): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}
