import type { ChatStatus } from "ai"
import { SquareIcon } from "lucide-react"
import { useCallback } from "react"

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { ArrowUpIcon } from "@/components/ui/arrow-up"

type InstructChatComposerProps = {
  value: string
  status: ChatStatus
  disabled?: boolean
  canCancelRun?: boolean
  onCancelRun?: () => Promise<void> | void
  onSubmit: (content: string) => Promise<void> | void
  onValueChange: (value: string) => void
}

export function InstructChatComposer({
  value,
  status,
  disabled = false,
  canCancelRun = false,
  onCancelRun,
  onSubmit,
  onValueChange,
}: InstructChatComposerProps) {
  const isGenerating = status === "submitted" || status === "streaming"
  const submitDisabled = isGenerating
    ? !canCancelRun
    : disabled || !value.trim()

  const handleSubmit = useCallback(async (message: PromptInputMessage) => {
    await onSubmit(message.text)
  }, [onSubmit])

  const handleCancelRun = useCallback(() => {
    void onCancelRun?.()
  }, [onCancelRun])

  return (
    <div className="grid shrink-0 gap-3 border-border bg-transparent p-3">
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-14"
            disabled={disabled}
            onChange={(event) => onValueChange(event.currentTarget.value)}
            placeholder="描述你想创建的智能体..."
            value={value}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
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
