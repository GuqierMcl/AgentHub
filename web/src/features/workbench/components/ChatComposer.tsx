import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react"
import type { ChatStatus } from "ai"
import { useQuery } from "@tanstack/react-query"
import { CircleIcon, SquareIcon, XIcon } from "lucide-react"

import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  type AttachmentData,
} from "@/components/ai-elements/attachments"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input"
import { SpeechInput } from "@/components/ai-elements/speech-input"
import { AgentAvatar } from "@/components/agent-avatar"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAvatarOverrides } from "@/features/agents/hooks/use-avatar-overrides"
import { useServiceStatusStore } from "@/features/app-shell/store/service-status-store"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { workspaceMcpStatusApi } from "../api/workspace-mcp-status"
import { workbenchQueryKeys } from "../api/query-keys"
import type {
  ChatSubmitInput,
  Conversation,
  ConversationAgentProfile,
  MentionTarget,
  MessageReplySnapshot,
} from "../types"
import {
  getExternalAgentStatusBarItems,
  type ExternalAgentStatusBarItem,
} from "../utils/external-agent-status"
import {
  getWorkspaceMcpStatusBarItems,
} from "../utils/workspace-mcp-status"

type ComposerStatusBarItem = {
  id: string
  label: string
  statusLabel: string
  tone: ExternalAgentStatusBarItem["tone"]
  description?: string
}

function AttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: AttachmentData
  onRemove: (id: string) => void
}) {
  const handleRemove = useCallback(() => {
    onRemove(attachment.id)
  }, [attachment.id, onRemove])

  return (
    <Attachment data={attachment} onRemove={handleRemove}>
      <AttachmentPreview />
      <AttachmentRemove />
    </Attachment>
  )
}

function PromptInputAttachmentsDisplay() {
  const attachments = usePromptInputAttachments()

  const handleRemove = useCallback(
    (id: string) => {
      attachments.remove(id)
    },
    [attachments]
  )

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <AttachmentItem
          attachment={attachment}
          key={attachment.id}
          onRemove={handleRemove}
        />
      ))}
    </Attachments>
  )
}

type MentionTrigger = {
  start: number
  end: number
  query: string
}

const MENTION_TRIGGER_PATTERN = /(^|[\s([{"'，。！？、；：,.!?])@([^\s@]*)$/

function findMentionTrigger(value: string, caretIndex: number): MentionTrigger | null {
  const beforeCaret = value.slice(0, caretIndex)
  const match = beforeCaret.match(MENTION_TRIGGER_PATTERN)
  if (!match) return null

  const query = match[2] ?? ""
  return {
    start: beforeCaret.length - query.length - 1,
    end: caretIndex,
    query,
  }
}

function toMentionTarget(agent: ConversationAgentProfile): MentionTarget {
  return {
    agent,
    kind: "agent",
    id: agent.id,
    label: agent.name,
    shortLabel: agent.shortName,
  }
}

function matchesMentionTarget(target: MentionTarget, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [
    target.id,
    target.label,
    target.shortLabel ?? "",
  ].some((value) => value.toLowerCase().includes(normalized))
}

type ChatComposerProps = {
  agentProfiles: ConversationAgentProfile[]
  conversationId: string
  conversationMode: Conversation["mode"]
  value: string
  status: ChatStatus
  canCancelRun?: boolean
  disabled?: boolean
  onCancelRun?: () => Promise<void> | void
  onCancelReply?: () => void
  onValueChange: (value: string) => void
  onSubmit: (input: ChatSubmitInput) => Promise<void> | void
  replyTo?: MessageReplySnapshot | null
}

type ChatComposerInnerProps = ChatComposerProps

function ChatComposerInner({
  agentProfiles,
  canCancelRun = false,
  conversationId,
  conversationMode,
  disabled = false,
  onCancelRun,
  onCancelReply,
  onSubmit,
  onValueChange,
  replyTo,
  status,
  value,
}: ChatComposerInnerProps) {
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [mentionTarget, setMentionTarget] = useState<MentionTarget | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const mentionTargets = useMemo(() => {
    if (conversationMode !== "group") {
      return []
    }

    return agentProfiles
      .filter((agent) =>
        agent.id !== "orchestrator" &&
        agent.role !== "orchestrator" &&
        agent.enabled !== false
      )
      .map(toMentionTarget)
  }, [agentProfiles, conversationMode])
  const mentionQuery = mentionTrigger?.query ?? ""
  const filteredMentionTargets = useMemo(
    () => mentionTargets.filter((target) => matchesMentionTarget(target, mentionQuery)),
    [mentionQuery, mentionTargets]
  )
  const clampedMentionIndex = Math.min(
    activeMentionIndex,
    Math.max(filteredMentionTargets.length - 1, 0)
  )
  const activeMentionTarget =
    filteredMentionTargets[clampedMentionIndex] ?? filteredMentionTargets[0]
  const mentionMenuOpen = mentionOpen && !disabled
  const mentionEmptyText = conversationMode === "group"
    ? mentionQuery
      ? "没有匹配的智能体"
      : "暂无可 @ 的智能体"
    : "当前会话暂无智能体候选"
  const isGenerating = status === "submitted" || status === "streaming"
  const submitDisabled = isGenerating
    ? !canCancelRun
    : disabled || !value.trim()

  const queryRef = useRef(mentionQuery)

  const closeMentionMenu = useCallback(() => {
    setMentionOpen(false)
    setMentionTrigger(null)
  }, [])

  const updateMentionTrigger = useCallback((nextValue: string, caretIndex: number | null) => {
    if (!nextValue.trim() || caretIndex === null || disabled) {
      closeMentionMenu()
      return
    }

    const trigger = findMentionTrigger(nextValue, caretIndex)
    const nextQuery = trigger?.query ?? ""
    if (nextQuery !== queryRef.current) {
      queryRef.current = nextQuery
      setActiveMentionIndex(0)
    }
    setMentionTrigger(trigger)
    setMentionOpen(Boolean(trigger))
  }, [closeMentionMenu, disabled])

  const selectMentionTarget = useCallback((target: MentionTarget) => {
    const textarea = textareaRef.current
    const caretIndex = textarea?.selectionStart ?? value.length
    const trigger = findMentionTrigger(value, caretIndex) ?? mentionTrigger
    if (!trigger) return

    const mentionText = `@${target.label} `
    const nextValue = `${value.slice(0, trigger.start)}${mentionText}${value.slice(trigger.end)}`
    const nextCaretIndex = trigger.start + mentionText.length

    onValueChange(nextValue)
    setMentionTarget(target)
    closeMentionMenu()

    requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current
      nextTextarea?.focus()
      nextTextarea?.setSelectionRange(nextCaretIndex, nextCaretIndex)
    })
  }, [closeMentionMenu, mentionTrigger, onValueChange, value])

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    await onSubmit({
      content: message.text,
      ...(mentionTarget ? { addressedAgentIds: [mentionTarget.id] } : {}),
    })
    setMentionTarget(null)
    closeMentionMenu()
  }, [closeMentionMenu, mentionTarget, onSubmit])

  const handleCancelRun = useCallback(() => {
    void onCancelRun?.()
  }, [onCancelRun])

  const handleTranscriptionChange = useCallback((transcript: string) => {
    onValueChange(value ? `${value} ${transcript}` : transcript)
  }, [onValueChange, value])

  const handleMentionOpenChange = useCallback((open: boolean) => {
    if (!open) {
      closeMentionMenu()
    }
  }, [closeMentionMenu])

  const handleTextareaChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.currentTarget.value
    onValueChange(nextValue)
    updateMentionTrigger(nextValue, event.currentTarget.selectionStart)
  }, [onValueChange, updateMentionTrigger])

  const handleMentionKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!mentionMenuOpen) return

    if (event.key === "Escape") {
      event.preventDefault()
      closeMentionMenu()
      return
    }

    if (filteredMentionTargets.length === 0) {
      return
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveMentionIndex((index) => (index + 1) % filteredMentionTargets.length)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveMentionIndex((index) =>
        (index - 1 + filteredMentionTargets.length) % filteredMentionTargets.length
      )
      return
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      activeMentionTarget
    ) {
      event.preventDefault()
      selectMentionTarget(activeMentionTarget)
    }
  }, [
    activeMentionTarget,
    closeMentionMenu,
    filteredMentionTargets.length,
    mentionMenuOpen,
    selectMentionTarget,
  ])

  const handleClearMentionTarget = useCallback(() => {
    setMentionTarget(null)
  }, [])

  const serviceStatusSnapshot = useServiceStatusStore((state) => state.snapshot)
  const initializeServiceStatus = useServiceStatusStore((state) => state.initialize)
  const avatarOverrides = useAvatarOverrides().data?.agents ?? {}
  const externalStatusItems = useMemo(
    () => serviceStatusSnapshot
      ? getExternalAgentStatusBarItems(agentProfiles, serviceStatusSnapshot.services)
      : [],
    [agentProfiles, serviceStatusSnapshot]
  )
  const mcpStatusQuery = useQuery({
    queryKey: workbenchQueryKeys.conversations.mcpStatus(conversationId),
    queryFn: () => workspaceMcpStatusApi.get(conversationId),
    enabled: Boolean(conversationId),
    refetchInterval: isGenerating ? 3000 : false,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const wasGeneratingRef = useRef(isGenerating)

  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      void mcpStatusQuery.refetch()
    }
    wasGeneratingRef.current = isGenerating
  }, [isGenerating, mcpStatusQuery.refetch])

  const mcpStatusItems = useMemo(
    () => getWorkspaceMcpStatusBarItems(mcpStatusQuery.data),
    [mcpStatusQuery.data]
  )
  const statusBarItems = useMemo(
    () => [...externalStatusItems, ...mcpStatusItems],
    [externalStatusItems, mcpStatusItems]
  )

  useEffect(() => {
    void initializeServiceStatus()
  }, [initializeServiceStatus])

  return (
    <div className="grid shrink-0 gap-0 border-border bg-transparent p-3">
      <PromptInput
        className={cn(
          statusBarItems.length > 0 &&
            "[&_[data-slot=input-group]]:rounded-b-none"
        )}
        globalDrop
        multiple
        onSubmit={handleSubmit}
      >
        <PromptInputHeader>
          <PromptInputAttachmentsDisplay />
          {replyTo ? (
            <div className="flex min-w-0 max-w-full items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-muted-foreground">
                  回复 {formatReplyTargetLabel(replyTo)}
                </div>
                <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground/90">
                  {replyTo.excerpt}
                </div>
              </div>
              <Button
                aria-label="取消回复"
                className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={onCancelReply}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </div>
          ) : null}
          {mentionTarget ? (
            <Badge className="h-6 max-w-full gap-1 px-1.5" variant="default">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 text-[10px]">
                @
              </span>
              <span className="truncate">{mentionTarget.label}</span>
              <Button
                aria-label="清除 @ 目标"
                className="-mr-1 size-4 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                onClick={handleClearMentionTarget}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </Badge>
          ) : null}
        </PromptInputHeader>
        <PromptInputBody>
          <Popover open={mentionMenuOpen} onOpenChange={handleMentionOpenChange}>
            <PopoverAnchor asChild>
              <div className="w-full">
                <PromptInputTextarea
                  className="min-h-14"
                  disabled={disabled}
                  onChange={handleTextareaChange}
                  onKeyDown={handleMentionKeyDown}
                  placeholder="说点什么吧..."
                  ref={textareaRef}
                  value={value}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              className="w-72 p-0"
              onCloseAutoFocus={(event) => event.preventDefault()}
              onOpenAutoFocus={(event) => event.preventDefault()}
              side="top"
            >
              <Command onKeyDown={handleMentionKeyDown} shouldFilter={false}>
                <CommandList>
                  {filteredMentionTargets.length === 0 ? (
                    <CommandEmpty className="px-3 text-muted-foreground">
                      {mentionEmptyText}
                    </CommandEmpty>
                  ) : (
                    <CommandGroup heading="智能体">
                      {filteredMentionTargets.map((target, index) => {
                        const isActive = clampedMentionIndex === index
                        return (
                          <CommandItem
                            aria-selected={isActive}
                            className={cn(
                              isActive && "bg-accent text-accent-foreground ring-1 ring-border"
                            )}
                            data-checked={mentionTarget?.id === target.id}
                            key={target.id}
                            onMouseEnter={() => setActiveMentionIndex(index)}
                            onSelect={() => selectMentionTarget(target)}
                            value={target.id}
                          >
                            <AgentAvatar
                              agent={target.agent}
                              className={cn(
                                "shrink-0",
                                isActive && "ring-2 ring-primary/20"
                              )}
                              override={avatarOverrides[target.id]}
                              size="sm"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{target.label}</span>
                              <span
                                className={cn(
                                  "block truncate text-xs",
                                  isActive ? "text-accent-foreground" : "text-muted-foreground"
                                )}
                              >
                                @{target.id}
                              </span>
                            </span>
                            <span
                              aria-hidden
                              className={cn(
                                "size-1.5 rounded-full",
                                isActive ? "bg-primary" : "bg-transparent"
                              )}
                            />
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <SpeechInput
              className="shrink-0"
              onTranscriptionChange={handleTranscriptionChange}
              size="icon-sm"
              variant="ghost"
            />
          </PromptInputTools>
          <PromptInputSubmit
            disabled={submitDisabled}
            onStop={handleCancelRun}
            size="icon-sm"
            status={status}
          >
            {isGenerating ? (
              <SquareIcon />
            ) : (
              <ArrowUpIcon className="![&_svg]:size-4" size={16} />
            )}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
      <ExternalAgentStatusBar items={statusBarItems} />
    </div>
  )
}

function ExternalAgentStatusBar({ items }: { items: ComposerStatusBarItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="-mt-px flex min-h-8 min-w-0 items-center rounded-b-2xl border border-border/70 bg-input/35 px-3 text-muted-foreground text-xs">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {items.map((item) => (
          <ExternalAgentStatusPill item={item} key={item.id} />
        ))}
      </div>
    </div>
  )
}

function ExternalAgentStatusPill({ item }: { item: ComposerStatusBarItem }) {
  const ariaLabel = item.description
    ? `${item.label}：${item.statusLabel}，${item.description}`
    : `${item.label}：${item.statusLabel}`

  return (
    <Badge
      aria-label={ariaLabel}
      className="max-w-full gap-1.5 border-border/60 bg-background/70 px-2 font-normal"
      title={item.description}
      variant="outline"
    >
      <CircleIcon
        className={cn(
          "size-2 fill-current stroke-none",
          getExternalAgentStatusDotClass(item.tone)
        )}
      />
      <span className="max-w-32 truncate text-foreground/80">{item.label}</span>
      <span className={cn("shrink-0", getExternalAgentStatusTextClass(item.tone))}>
        {item.statusLabel}
      </span>
    </Badge>
  )
}

function getExternalAgentStatusDotClass(tone: ComposerStatusBarItem["tone"]): string {
  switch (tone) {
    case "success":
      return "text-emerald-500"
    case "warning":
      return "text-amber-500"
    case "danger":
      return "text-destructive"
    case "muted":
      return "text-muted-foreground/60"
  }
}

function getExternalAgentStatusTextClass(tone: ComposerStatusBarItem["tone"]): string {
  switch (tone) {
    case "success":
      return "text-emerald-600 dark:text-emerald-400"
    case "warning":
      return "text-amber-600 dark:text-amber-400"
    case "danger":
      return "text-destructive"
    case "muted":
      return "text-muted-foreground"
  }
}

export function ChatComposer({ conversationId, ...rest }: ChatComposerProps) {
  return <ChatComposerInner key={conversationId} conversationId={conversationId} {...rest} />
}

function formatReplyTargetLabel(replyTo: MessageReplySnapshot): string {
  const sender = replyTo.agentId ?? replyTo.senderId
  return sender && sender !== replyTo.role
    ? `${replyTo.role} ${sender}`
    : replyTo.role
}
