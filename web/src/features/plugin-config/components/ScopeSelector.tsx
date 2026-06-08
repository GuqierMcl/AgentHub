import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  RotatingTextContainer,
  RotatingText,
} from "@/components/animate-ui/primitives/texts/rotating"
import { conversationsApi } from "@/features/workbench/api/conversations"
import type { ConversationListItem } from "@/features/workbench/types"
import type { CapabilityScope } from "../types"

type ScopeSelectorProps = {
  scope: CapabilityScope
  onScopeChange: (scope: CapabilityScope, conversationId?: string) => void
  conversationId?: string
}

export function ScopeSelector({
  scope,
  onScopeChange,
  conversationId,
}: ScopeSelectorProps) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])

  useEffect(() => {
    if (scope !== "global") {
      conversationsApi.list("active").then(setConversations).catch(() => setConversations([]))
    }
  }, [scope])

  const isGlobal = scope === "global"

  const handleSwitchChange = (checked: boolean) => {
    onScopeChange(checked ? "workspace" : "global")
  }

  const handleConversationChange = (value: string) => {
    onScopeChange("workspace", value)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center gap-2">
        <Switch checked={!isGlobal} onCheckedChange={handleSwitchChange} />
        <RotatingTextContainer text={isGlobal ? "全局" : "会话"} style={{ paddingBlock: 0 }}>
          <RotatingText
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="text-base font-semibold text-foreground/80 select-none"
          />
        </RotatingTextContainer>
      </div>

      <AnimatePresence mode="wait">
        {!isGlobal && (
          <motion.div
            key="conversation-selector"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <Select
              value={conversationId ?? ""}
              onValueChange={handleConversationChange}
            >
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder="选择会话..." />
              </SelectTrigger>
              <SelectContent>
                {conversations.map((conv) => (
                  <SelectItem key={conv.id} value={conv.id} className="text-xs">
                    {conv.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
