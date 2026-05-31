import { useCallback, useMemo, useState } from "react"
import type { ChatStatus } from "ai"
import { CheckIcon, GlobeIcon, SquareIcon } from "lucide-react"

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


import { modelChefs, modelOptions } from "../mock-data"

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
  value: string
  status: ChatStatus
  canCancelRun?: boolean
  disabled?: boolean
  onCancelRun?: () => Promise<void> | void
  onValueChange: (value: string) => void
  onSubmit: (message: string) => Promise<void> | void
}

export function ChatComposer({
  canCancelRun = false,
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

  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.id === model),
    [model]
  )
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

  const handleTranscriptionChange = useCallback((transcript: string) => {
    onValueChange(value ? `${value} ${transcript}` : transcript)
  }, [onValueChange, value])

  const handleModelSelect = useCallback((modelId: string) => {
    setModel(modelId)
    setModelSelectorOpen(false)
  }, [])

  return (
    <div className="grid shrink-0 gap-3 border-border bg-transparent p-3">
      <PromptInput globalDrop multiple onSubmit={handleSubmit}>
        <PromptInputHeader>
          <PromptInputAttachmentsDisplay />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-14"
            disabled={disabled}
            onChange={(event) => onValueChange(event.currentTarget.value)}
            placeholder="说点什么吧..."
            value={value}
          />
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
