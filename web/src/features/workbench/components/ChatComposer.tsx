import { useCallback, useMemo, useState } from "react"
import { CheckIcon, GlobeIcon } from "lucide-react"

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
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"

import { modelChefs, modelOptions, suggestedPrompts } from "../mock-data"

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
      <ModelSelectorLogo provider={model.chefSlug} />
      <ModelSelectorName>{model.name}</ModelSelectorName>
      <ModelSelectorLogoGroup>
        {model.providers.map((provider) => (
          <ModelSelectorLogo key={provider} provider={provider} />
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

export function ChatComposer() {
  const [input, setInput] = useState("")
  const [useWebSearch, setUseWebSearch] = useState(false)
  const [model, setModel] = useState(modelOptions[0].id)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)

  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.id === model),
    [model]
  )

  const handleSubmit = useCallback((message: PromptInputMessage) => {
    setInput(message.text)
  }, [])

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInput(suggestion)
  }, [])

  const handleTranscriptionChange = useCallback((transcript: string) => {
    setInput((current) => (current ? `${current} ${transcript}` : transcript))
  }, [])

  const handleModelSelect = useCallback((modelId: string) => {
    setModel(modelId)
    setModelSelectorOpen(false)
  }, [])

  return (
    <div className="grid shrink-0 gap-3 border-border border-t bg-background p-3">
      <Suggestions>
        {suggestedPrompts.map((suggestion) => (
          <Suggestion
            key={suggestion}
            onClick={handleSuggestionClick}
            suggestion={suggestion}
          />
        ))}
      </Suggestions>

      <PromptInput globalDrop multiple onSubmit={handleSubmit}>
        <PromptInputHeader>
          <PromptInputAttachmentsDisplay />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-14"
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder="@AgentHub 描述下一步任务..."
            value={input}
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
                <PromptInputButton>
                  {selectedModel?.chefSlug ? (
                    <ModelSelectorLogo provider={selectedModel.chefSlug} />
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
          <PromptInputSubmit disabled={!input.trim()} status="ready" />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
