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
import { CheckIcon, GlobeIcon, SquareIcon, XIcon } from "lucide-react"

import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  type AttachmentData,
} from "@/components/ai-elements/attachments"
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input"
import { SpeechInput } from "@/components/ai-elements/speech-input"
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


import { modelChefs, modelOptions } from "../mock-data"
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

type ModelOption = (typeof modelOptions)[number]

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

function ModelItem({
  isSelected,
  model,
  onSelect,
}: {
  isSelected: boolean
  model: ModelOption
  onSelect: (modelId: string) => void
}) {
  const handleSelect = useCallback(() => {
    onSelect(model.id)
  }, [model.id, onSelect])

  return (
    <ModelSelectorItem onSelect={handleSelect} value={model.id}>
      <ModelSelectorLogo provider={model.chefSlug} onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
      <ModelSelectorName>{model.name}</ModelSelectorName>
      <ModelSelectorLogoGroup>
        {model.providers.map((provider) => (
          <ModelSelectorLogo key={provider} provider={provider} onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
        ))}
      </ModelSelectorLogoGroup>
      {isSelected ? (
        <CheckIcon className="ml-auto size-4" />
      ) : (
        <div className="ml-auto size-4" />
      )}
    </ModelSelectorItem>
  )
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

export function ChatComposer({
  agentProfiles,
  canCancelRun = false,
  conversationId,
  conversationMode,
  disabled = false,
  onCancelRun,
  onSubmit,
  onValueChange,
  status,
  value,
}: ChatComposerProps) {
  const [useWebSearch, setUseWebSearch] = useState(false)
  const [model, setModel] = useState(modelOptions[0].id)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [mentionTarget, setMentionTarget] = useState<MentionTarget | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.id === model),
    [model]
  )
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
  const activeMentionTarget =
    filteredMentionTargets[activeMentionIndex] ?? filteredMentionTargets[0]
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

  useEffect(() => {
    setMentionTarget(null)
    setMentionOpen(false)
    setMentionTrigger(null)
  }, [conversationId])

  useEffect(() => {
    setActiveMentionIndex(0)
  }, [mentionQuery, mentionTargets])

  useEffect(() => {
    if (activeMentionIndex < filteredMentionTargets.length) return
    setActiveMentionIndex(Math.max(filteredMentionTargets.length - 1, 0))
  }, [activeMentionIndex, filteredMentionTargets.length])

  useEffect(() => {
    if (value.trim()) return
    setMentionTarget(null)
    setMentionOpen(false)
    setMentionTrigger(null)
  }, [value])

  const closeMentionMenu = useCallback(() => {
    setMentionOpen(false)
    setMentionTrigger(null)
  }, [])

  const updateMentionTrigger = useCallback((nextValue: string, caretIndex: number | null) => {
    if (caretIndex === null || disabled) {
      closeMentionMenu()
      return
    }

    const trigger = findMentionTrigger(nextValue, caretIndex)
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

  const handleModelSelect = useCallback((modelId: string) => {
    setModel(modelId)
    setModelSelectorOpen(false)
  }, [])

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
            <Badge className="max-w-full gap-1" variant="secondary">
              <span className="truncate">To: {mentionTarget.label}</span>
              <Button
                aria-label="清除 @ 目标"
                className="-mr-1 size-4"
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
                        const isActive = activeMentionIndex === index
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
            <PromptInputButton
              disabled={disabled}
              onClick={() => setUseWebSearch((value) => !value)}
              variant={useWebSearch ? "default" : "ghost"}
            >
              <GlobeIcon />
              <span>Search</span>
            </PromptInputButton>
            <ModelSelector
              onOpenChange={setModelSelectorOpen}
              open={modelSelectorOpen}
            >
              <ModelSelectorTrigger asChild>
                <PromptInputButton disabled={disabled}>
                  {selectedModel?.chefSlug ? (
                    <ModelSelectorLogo provider={selectedModel.chefSlug} onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                  ) : null}
                  {selectedModel?.name ? (
                    <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
                  ) : null}
                </PromptInputButton>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder="Search models..." />
                <ModelSelectorList>
                  <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                  {modelChefs.map((chef) => (
                    <ModelSelectorGroup heading={chef} key={chef}>
                      {modelOptions
                        .filter((option) => option.chef === chef)
                        .map((option) => (
                          <ModelItem
                            isSelected={model === option.id}
                            key={option.id}
                            model={option}
                            onSelect={handleModelSelect}
                          />
                        ))}
                    </ModelSelectorGroup>
                  ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          </PromptInputTools>
          <PromptInputSubmit
            disabled={submitDisabled}
            onStop={handleCancelRun}
            size={isGenerating ? "sm" : "icon-sm"}
            status={status}
          >
            {isGenerating ? (
              <>
                <SquareIcon data-icon="inline-start" />
                停止回答
              </>
            ) : undefined}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
