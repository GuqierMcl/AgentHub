import { ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { conversationMessagesApi } from "../api/messages"
import type { QuestionAnswerBody } from "../api/messages"
import type {
  ConversationAgentProfile,
  WorkbenchTimelineQuestionItem,
} from "../types"

type QuestionDraft = {
  optionId?: string
  customText?: string
  custom?: boolean
}

type QuestionAnswerComposerProps = {
  agentProfiles: ConversationAgentProfile[]
  onSkipRun: (runId: string) => Promise<void> | void
  requests: WorkbenchTimelineQuestionItem[]
}

export function QuestionAnswerComposer({
  agentProfiles,
  onSkipRun,
  requests,
}: QuestionAnswerComposerProps) {
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests]
  )
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | undefined>(
    undefined
  )
  const activeRequestId = useMemo(() => {
    if (pendingRequests.length === 0) return null
    if (
      selectedRequestId &&
      pendingRequests.some((request) => request.requestId === selectedRequestId)
    ) {
      return selectedRequestId
    }
    return pendingRequests[0]?.requestId ?? null
  }, [pendingRequests, selectedRequestId])
  const activeRequest = useMemo(
    () =>
      pendingRequests.find((request) => request.requestId === activeRequestId) ??
      pendingRequests[0],
    [pendingRequests, activeRequestId]
  )
  const activeQuestionId = useMemo(() => {
    if (!activeRequest) return undefined
    if (
      selectedQuestionId &&
      activeRequest.questions.some((question) => question.id === selectedQuestionId)
    ) {
      return selectedQuestionId
    }
    return activeRequest.questions[0]?.id
  }, [activeRequest, selectedQuestionId])
  const [draftsByRequest, setDraftsByRequest] = useState<
    Record<string, Record<string, QuestionDraft>>
  >({})
  const [submittingRequestId, setSubmittingRequestId] = useState<string | null>(null)
  const [skippingRequestId, setSkippingRequestId] = useState<string | null>(null)
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentDrafts = useMemo(
    () =>
      activeRequest
        ? draftsByRequest[activeRequest.requestId] ?? {}
        : {},
    [activeRequest, draftsByRequest]
  )
  const missingRequired = activeRequest
    ? activeRequest.questions.filter((question) =>
        question.required && !isQuestionAnswered(question.id, currentDrafts[question.id])
      )
    : []
  const canSubmit =
    Boolean(activeRequest) &&
    missingRequired.length === 0 &&
    submittingRequestId === null &&
    skippingRequestId === null &&
    submittedRequestId !== activeRequest?.requestId

  const setDraft = useCallback((
    requestId: string,
    questionId: string,
    draft: QuestionDraft
  ) => {
    setDraftsByRequest((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? {}),
        [questionId]: {
          ...(current[requestId]?.[questionId] ?? {}),
          ...draft,
        },
      },
    }))
  }, [])

  const submit = useCallback(async () => {
    if (!activeRequest || !canSubmit) return
    const answers: QuestionAnswerBody["answers"] = activeRequest.questions.flatMap<
      QuestionAnswerBody["answers"][number]
    >((question) => {
      const draft = currentDrafts[question.id]
      if (!draft) return []
      if (draft.custom) {
        const answer = draft.customText?.trim()
        return answer
          ? [{ questionId: question.id, answer, custom: true }]
          : []
      }
      return draft.optionId
        ? [{ questionId: question.id, optionId: draft.optionId, custom: false }]
        : []
    })

    setSubmittingRequestId(activeRequest.requestId)
    setError(null)
    try {
      await conversationMessagesApi.answerQuestion(activeRequest.runId, activeRequest.requestId, {
        answers,
      })
      setSubmittedRequestId(activeRequest.requestId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Question answer failed")
      setSubmittedRequestId(null)
    } finally {
      setSubmittingRequestId(null)
    }
  }, [activeRequest, canSubmit, currentDrafts])

  const skipRun = useCallback(async () => {
    if (!activeRequest || skippingRequestId !== null || submittingRequestId !== null) return

    setSkippingRequestId(activeRequest.requestId)
    setError(null)
    try {
      await onSkipRun(activeRequest.runId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Question skip failed")
    } finally {
      setSkippingRequestId(null)
    }
  }, [activeRequest, onSkipRun, skippingRequestId, submittingRequestId])

  if (!activeRequest) {
    return null
  }

  const activeAgent = agentProfiles.find((agent) => agent.id === activeRequest.agentId)
  const activeQuestionIdValue = activeQuestionId ?? activeRequest.questions[0]?.id
  const activeQuestionIndex = Math.max(
    activeRequest.questions.findIndex((question) => question.id === activeQuestionIdValue),
    0
  )
  const activeQuestion = activeRequest.questions[activeQuestionIndex]
  const nextQuestion = activeRequest.questions[activeQuestionIndex + 1]
  const isLastQuestion = !nextQuestion
  const submitting = submittingRequestId === activeRequest.requestId
  const skipping = skippingRequestId === activeRequest.requestId
  const busy = submitting || skipping
  const activeDraft = activeQuestion ? currentDrafts[activeQuestion.id] : undefined
  const canGoNext =
    Boolean(nextQuestion) &&
    submittingRequestId === null &&
    skippingRequestId === null &&
    Boolean(
      activeQuestion &&
        (!activeQuestion.required ||
          isQuestionAnswered(activeQuestion.id, activeDraft))
    )

  return (
    <div className="shrink-0 bg-transparent p-3 sm:p-4">
      <Card
        className="mx-auto max-h-[min(52vh,34rem)] max-w-3xl border bg-card shadow-sm"
        size="sm"
      >
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">{activeRequest.title}</CardTitle>
              <CardDescription className="mt-1 truncate">
                {activeAgent?.name ?? activeRequest.agentId ?? "Agent"}
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary">
                {activeQuestionIndex + 1}/{activeRequest.questions.length}
              </Badge>
              {pendingRequests.length > 1 ? (
                <Badge variant="outline">待回答 {pendingRequests.length}</Badge>
              ) : null}
            </div>
          </div>
          {pendingRequests.length > 1 ? (
            <Tabs
              className="flex-col"
              onValueChange={(requestId) => {
                const request = pendingRequests.find((item) => item.requestId === requestId)
                setSelectedRequestId(requestId)
                setSelectedQuestionId(request?.questions[0]?.id)
                setError(null)
              }}
              value={activeRequest.requestId}
            >
              <TabsList
                className="h-auto w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0"
                variant="line"
              >
                {pendingRequests.map((request, index) => (
                  <TabsTrigger
                    className="min-w-24 flex-none rounded-none px-3 py-2"
                    key={request.requestId}
                    value={request.requestId}
                  >
                    请求 {index + 1}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <Tabs
            className="w-full flex-col gap-4"
            onValueChange={setSelectedQuestionId}
            value={activeQuestionIdValue}
          >
            {activeRequest.questions.length > 1 ? (
              <TabsList className="grid h-auto w-full grid-flow-col auto-cols-[minmax(11rem,1fr)] overflow-x-auto rounded-full p-1">
                {activeRequest.questions.map((question, index) => {
                  const answered = isQuestionAnswered(
                    question.id,
                    currentDrafts[question.id]
                  )
                  return (
                    <TabsTrigger
                      className={cn(
                        "group min-w-0 justify-start gap-2 rounded-full px-3 py-2 text-left text-sm",
                        "data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground",
                        "data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-primary/20"
                      )}
                      key={question.id}
                      value={question.id}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                          {index + 1}
                        </span>
                        <span className="min-w-0 truncate">
                          {question.title}
                          {answered ? (
                            <span className="ml-1 text-primary">✓</span>
                          ) : question.required ? (
                            <span className="ml-1 text-destructive/80">· 未填</span>
                          ) : null}
                        </span>
                      </span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            ) : null}

            {activeRequest.questions.map((question) => {
              const draft = currentDrafts[question.id] ?? {}
              const isCustomSelected = draft.custom ?? false
              const answered = isQuestionAnswered(question.id, draft)
              const radioValue = draft.custom
                ? "custom"
                : draft.optionId
                  ? `option:${draft.optionId}`
                  : ""
              return (
                <TabsContent
                  className="mt-2"
                  key={question.id}
                  value={question.id}
                >
                  <FieldGroup className="gap-5">
                    <FieldSet className="gap-4">
                      <FieldTitle className="text-base">
                        {question.title}
                        {answered ? (
                          <Badge variant="secondary">✓</Badge>
                        ) : question.required ? (
                          <Badge variant="outline">未填</Badge>
                        ) : null}
                      </FieldTitle>
                      <FieldDescription className="text-sm leading-6">
                        {question.body}
                      </FieldDescription>
                      <RadioGroup
                        className="gap-2"
                        onValueChange={(value) => {
                          if (value === "custom") {
                            setDraft(activeRequest.requestId, question.id, { custom: true })
                            return
                          }
                          setDraft(activeRequest.requestId, question.id, {
                            custom: false,
                            optionId: value.replace(/^option:/, ""),
                          })
                        }}
                        value={radioValue}
                      >
                        {question.options.map((option) => {
                          const inputId = `${activeRequest.requestId}-${question.id}-${option.id}`
                          const isSelected = radioValue === `option:${option.id}`
                          return (
                            <Field
                              data-selected={isSelected}
                              className={cn(
                                "relative cursor-pointer rounded-xl border bg-background p-3 transition-all",
                                "hover:border-primary/40 hover:bg-muted/30",
                                "data-[selected=true]:border-primary data-[selected=true]:bg-primary/15",
                                "data-[selected=true]:shadow-md data-[selected=true]:ring-2 data-[selected=true]:ring-primary/35",
                                "data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-2 data-[selected=true]:before:left-1.5 data-[selected=true]:before:w-1 data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-primary"
                              )}
                              key={option.id}
                              onClick={() => {
                                setDraft(activeRequest.requestId, question.id, {
                                  custom: false,
                                  optionId: option.id,
                                })
                              }}
                              orientation="horizontal"
                            >
                              <RadioGroupItem
                                id={inputId}
                                value={`option:${option.id}`}
                              />
                              <FieldContent className="min-w-0">
                                <FieldLabel
                                  className="w-auto min-w-0 whitespace-normal break-words"
                                  htmlFor={inputId}
                                >
                                  {option.label}
                                </FieldLabel>
                                {option.description ? (
                                  <FieldDescription className="break-words">
                                    {option.description}
                                  </FieldDescription>
                                ) : null}
                              </FieldContent>
                              {isSelected ? (
                                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                  <CheckIcon className="size-4" />
                                </span>
                              ) : null}
                            </Field>
                          )
                        })}
                        {question.allowCustom ? (
                          <Field
                            data-selected={isCustomSelected}
                            className={cn(
                              "relative cursor-pointer rounded-xl border bg-background p-3 transition-all",
                              "hover:border-primary/40 hover:bg-muted/30",
                              "data-[selected=true]:border-primary data-[selected=true]:bg-primary/15",
                              "data-[selected=true]:shadow-md data-[selected=true]:ring-2 data-[selected=true]:ring-primary/35",
                              "data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-2 data-[selected=true]:before:left-1.5 data-[selected=true]:before:w-1 data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-primary"
                            )}
                            onClick={() => {
                              setDraft(activeRequest.requestId, question.id, { custom: true })
                            }}
                            orientation="horizontal"
                          >
                            <RadioGroupItem
                              id={`${activeRequest.requestId}-${question.id}-custom`}
                              value="custom"
                            />
                            <FieldContent className="min-w-0 flex-1">
                              {isCustomSelected ? (
                                <Textarea
                                  autoFocus
                                  className="min-h-9 resize-y py-2"
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    setDraft(activeRequest.requestId, question.id, {
                                      custom: true,
                                      customText: event.target.value,
                                    })
                                  }}
                                  onFocus={() => {
                                    setDraft(activeRequest.requestId, question.id, { custom: true })
                                  }}
                                  placeholder="输入自定义答案"
                                  rows={1}
                                  value={draft.customText ?? ""}
                                />
                              ) : (
                                <FieldLabel
                                  className="w-auto min-w-0 whitespace-normal break-words"
                                  htmlFor={`${activeRequest.requestId}-${question.id}-custom`}
                                >
                                  自定义答案
                                </FieldLabel>
                              )}
                              {isCustomSelected && !draft.customText?.trim() ? (
                                <FieldError>请填写自定义答案。</FieldError>
                              ) : null}
                            </FieldContent>
                            {isCustomSelected ? (
                              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                <CheckIcon className="size-4" />
                              </span>
                            ) : null}
                          </Field>
                        ) : null}
                      </RadioGroup>
                    </FieldSet>
                  </FieldGroup>
                </TabsContent>
              )
            })}
          </Tabs>

          {error ? (
            <>
              <Separator />
              <FieldError>{error}</FieldError>
            </>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <div className="min-w-0 text-muted-foreground text-sm">
            <span className="block truncate">
              {missingRequired.length > 0
                ? `还有 ${missingRequired.length} 个必填问题`
                : "可以提交"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              disabled={busy}
              onClick={() => void skipRun()}
              type="button"
              variant="outline"
            >
              {skipping ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : null}
              跳过
            </Button>
            {isLastQuestion ? (
              <Button disabled={!canSubmit} onClick={() => void submit()} type="button">
                {submitting ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <CheckIcon data-icon="inline-start" />
                )}
                提交
              </Button>
            ) : (
              <Button
                disabled={!canGoNext}
                onClick={() => {
                  if (nextQuestion) {
                    setSelectedQuestionId(nextQuestion.id)
                  }
                }}
                type="button"
              >
                下一题
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

function isQuestionAnswered(
  questionId: string,
  draft: QuestionDraft | undefined
): boolean {
  if (!draft) return false
  if (draft.custom) {
    return Boolean(draft.customText?.trim())
  }
  return Boolean(questionId && draft.optionId)
}
