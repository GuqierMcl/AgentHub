import { PinIcon, XIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MessagePin } from "../api/messages"

type PinnedMessagesBarProps = {
  pins: MessagePin[]
  onUnpin: (pin: MessagePin) => void
}

export function PinnedMessagesBar({ pins, onUnpin }: PinnedMessagesBarProps) {
  const [expanded, setExpanded] = useState(true)

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  if (pins.length === 0) return null

  return (
    <div className="flex flex-col gap-1 border-b bg-muted/30 px-4 py-2">
      <button
        className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs hover:text-foreground"
        onClick={toggleExpanded}
        type="button"
      >
        <PinIcon className="size-3 shrink-0" />
        <span className="font-medium">{pins.length} 条置顶消息</span>
        <span className="text-[10px]">{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-1 pt-1">
          {pins.map((pin) => (
            <PinnedMessageItem key={pin.id} pin={pin} onUnpin={onUnpin} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PinnedMessageItem({
  pin,
  onUnpin,
}: {
  pin: MessagePin
  onUnpin: (pin: MessagePin) => void
}) {
  const handleUnpin = useCallback(() => {
    onUnpin(pin)
  }, [pin, onUnpin])

  const messageText = normalizePinMessageText(pin)
  const itemTitle = pin.note ? `${pin.note}\n${messageText}` : messageText

  return (
    <div
      className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/50"
      title={itemTitle}
    >
      <PinIcon className="size-3 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {pin.note ? (
          <Badge
            className="max-w-32 truncate px-1.5 text-[10px]"
            title={pin.note}
            variant="secondary"
          >
            {pin.note}
          </Badge>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-foreground">
          {messageText}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            onClick={handleUnpin}
            type="button"
            aria-label="取消置顶"
          >
            <XIcon className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>取消置顶</TooltipContent>
      </Tooltip>
    </div>
  )
}

function normalizePinMessageText(pin: MessagePin): string {
  const content = pin.messageContent?.replace(/\s+/g, " ").trim()
  return content || `消息 ${pin.messageId}`
}
