import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

import type { AgentDetail } from "../types"
import { AgentConfigurationForm } from "./AgentConfigurationForm"

type AgentFormDialogProps = {
  onOpenChange: (open: boolean) => void
  onSaved: (agent: AgentDetail) => void
  open: boolean
}

export function AgentFormDialog({
  onOpenChange,
  onSaved,
  open,
}: AgentFormDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(740px,calc(100svh-2rem))] w-[620px] flex-col gap-0 p-0" from="top">
        <DialogHeader className="border-border border-b px-6 py-5 shrink-0">
          <DialogTitle>新增智能体</DialogTitle>
          <DialogDescription>创建可配置工具与权限的自定义主智能体。</DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6 pb-0">
            <AgentConfigurationForm
              active={open}
              hideAvatar
              hideFooter
              mode="create"
              onCancel={() => onOpenChange(false)}
              onSaved={onSaved}
            />
          </div>
        </ScrollArea>
        <div className="flex shrink-0 items-center justify-end gap-2 border-border border-t bg-background px-6 py-4">
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            取消
          </Button>
          <Button
            form="agent-create-form"
            type="submit"
          >
            创建智能体
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
