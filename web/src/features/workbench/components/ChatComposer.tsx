import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react"
import type { ChatStatus } from "ai"
import { SquareIcon, XIcon } from "lucide-react"

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
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import type {
  ChatSubmitInput,
  Conversation,
  ConversationAgentProfile,
  MentionTarget,
} from "../types"

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
    kind: "agent",
    id: agent.id,
    label: agent.name,
    shortLabel: agent.shortName,
  }
}

function getMentionShortLabel(target: MentionTarget): string {
  return target.shortLabel ?? Array.from(target.label || target.id)
    .slice(0, 2)
    .join("")
    .toUpperCase()
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
  onValueChange: (value: string) => void
  onSubmit: (input: ChatSubmitInput) => Promise<void> | void
}

type ChatComposerInnerProps = Omit<ChatComposerProps, "conversationId">

function ChatComposerInner({
  agentProfiles,
  canCancelRun = false,
  conversationMode,
  disabled = false,
  onCancelRun,
  onSubmit,
  onValueChange,
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

  return (
    <div className="grid shrink-0 gap-3 border-border bg-transparent p-3">
      <PromptInput globalDrop multiple onSubmit={handleSubmit}>
        <PromptInputHeader>
          <PromptInputAttachmentsDisplay />
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
                            <span
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                                isActive
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-foreground"
                              )}
                            >
                              {getMentionShortLabel(target)}
                            </span>
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
    </div>
  )
}

export function ChatComposer({ conversationId, ...rest }: ChatComposerProps) {
  return <ChatComposerInner key={conversationId} {...rest} />
}
