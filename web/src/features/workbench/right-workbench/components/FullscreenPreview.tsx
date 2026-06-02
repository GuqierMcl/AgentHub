import { useEffect, type ReactNode } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

type FullscreenPreviewProps = {
  open: boolean
  onClose: () => void
  name: string
  children: ReactNode
}

export function FullscreenPreview({ open, onClose, name, children }: FullscreenPreviewProps) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in zoom-in-95 duration-200">
      <div className="flex shrink-0 items-center justify-between border-border border-b px-4 py-2">
        <span className="truncate text-sm font-medium">{name}</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭全屏预览">
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}
