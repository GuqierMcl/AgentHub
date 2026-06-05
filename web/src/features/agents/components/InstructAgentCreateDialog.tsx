import { useCallback } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { InstructAgentCreateChat } from "@/features/instruct-agent/components/InstructAgentCreateChat"

type InstructAgentCreateDialogProps = {
  onOpenChange: (open: boolean) => void
  onOpenManualCreate: () => Promise<void> | void
  onOpenAgent: (agentId: string) => Promise<void> | void
  onRefreshAgents: () => Promise<void> | void
  open: boolean
}

export function InstructAgentCreateDialog({
  onOpenAgent,
  onOpenChange,
  onOpenManualCreate,
  onRefreshAgents,
  open,
}: InstructAgentCreateDialogProps) {
  const handleOpenAgent = useCallback(async (agentId: string) => {
    onOpenChange(false)
    await onOpenAgent(agentId)
  }, [onOpenAgent, onOpenChange])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[min(820px,calc(100svh-2rem))] w-[min(1120px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0"
        from="top"
      >
        <DialogTitle className="sr-only">对话式创建智能体</DialogTitle>
        <DialogDescription className="sr-only">
          在模态框中通过对话收集智能体配置并保存。
        </DialogDescription>
        <InstructAgentCreateChat
          onOpenManualCreate={onOpenManualCreate}
          onOpenAgent={handleOpenAgent}
          onRefreshAgents={onRefreshAgents}
        />
      </DialogContent>
    </Dialog>
  )
}
