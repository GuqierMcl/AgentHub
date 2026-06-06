import { useCallback, useState } from "react"
import { XIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/animate-ui/components/radix/alert-dialog"
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
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

  const handleCloseAttempt = useCallback(() => {
    setConfirmCloseOpen(true)
  }, [])

  const handleEscapeKeyDown = useCallback((e: Event) => {
    e.preventDefault()
    setConfirmCloseOpen(true)
  }, [])

  const handlePointerDownOutside = useCallback((e: Event) => {
    e.preventDefault()
    setConfirmCloseOpen(true)
  }, [])

  const handleConfirmClose = useCallback(() => {
    setConfirmCloseOpen(false)
    onOpenChange(false)
  }, [onOpenChange])

  const handleCancelClose = useCallback(() => {
    setConfirmCloseOpen(false)
  }, [])

  const handleOpenAgent = useCallback(async (agentId: string) => {
    onOpenChange(false)
    await onOpenAgent(agentId)
  }, [onOpenAgent, onOpenChange])

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent
          className="flex h-[min(820px,calc(100svh-2rem))] w-[min(1120px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0"
          from="top"
          showCloseButton={false}
          onEscapeKeyDown={handleEscapeKeyDown}
          onPointerDownOutside={handlePointerDownOutside}
        >
          <button
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border-none bg-transparent hover:bg-muted"
            onClick={handleCloseAttempt}
            type="button"
          >
            <XIcon className="size-4" />
            <span className="sr-only">关闭</span>
          </button>
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

      <AlertDialog onOpenChange={setConfirmCloseOpen} open={confirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认关闭</AlertDialogTitle>
            <AlertDialogDescription>
              关闭后不会保存聊天记录，是否关闭？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelClose}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>确认关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
