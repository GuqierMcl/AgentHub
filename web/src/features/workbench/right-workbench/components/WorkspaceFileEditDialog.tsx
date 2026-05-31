import { useState, useEffect, useCallback, useRef } from "react"
import { Loader2Icon, AlertCircleIcon, CheckCircle2Icon } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

import { workspaceBrowserApi } from "../api/workspace-browser"
import { EditableCodeEditor } from "./preview-renderers/EditableCodeEditor"

type WorkspaceFileEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: string
  path: string
}

type EditorStatus =
  | { type: "loading" }
  | { type: "ready"; revision: string }
  | { type: "saving" }
  | { type: "saved"; revision: string }
  | { type: "error"; message: string }
  | { type: "conflict"; message: string }

export function WorkspaceFileEditDialog({ open, onOpenChange, conversationId, path }: WorkspaceFileEditDialogProps) {
  const [originalContent, setOriginalContent] = useState<string>("")
  const [draftContent, setDraftContent] = useState<string>("")
  const [status, setStatus] = useState<EditorStatus>({ type: "loading" })
  const [fileName, setFileName] = useState("")
  const [fileLanguage, setFileLanguage] = useState<string | undefined>(undefined)
  const [fileSize, setFileSize] = useState(0)
  const loadIdRef = useRef(0)

  const isDirty = originalContent !== draftContent

  useEffect(() => {
    if (!open || !conversationId || !path) return

    const loadId = ++loadIdRef.current

    workspaceBrowserApi.getEditableFile(conversationId, path).then((data) => {
      if (loadId !== loadIdRef.current) return
      setOriginalContent(data.content)
      setDraftContent(data.content)
      setFileName(data.name)
      setFileLanguage(data.language)
      setFileSize(data.size)
      setStatus({ type: "ready", revision: data.revision })
    }).catch((err) => {
      if (loadId !== loadIdRef.current) return
      setStatus({ type: "error", message: err instanceof Error ? err.message : "加载文件失败" })
    })
  }, [open, conversationId, path])

  const handleSave = useCallback(async () => {
    if (!conversationId || !path || status.type !== "ready") return

    setStatus({ type: "saving" })
    try {
      const result = await workspaceBrowserApi.saveFile(conversationId, {
        path,
        content: draftContent,
        revision: status.revision,
      })
      setOriginalContent(draftContent)
      setStatus({ type: "saved", revision: result.revision })
      setTimeout(() => {
        setStatus((prev) => prev.type === "saved" ? { type: "ready", revision: result.revision } : prev)
      }, 2000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败"
      if (msg.includes("冲突") || msg.includes("CONFLICT") || msg.includes("revision")) {
        setStatus({ type: "conflict", message: msg })
      } else {
        setStatus({ type: "error", message: msg })
      }
    }
  }, [conversationId, path, draftContent, status])

  const handleReset = useCallback(() => {
    setDraftContent(originalContent)
    setStatus((prev) => {
      if (prev.type === "error" || prev.type === "conflict") {
        return { type: "ready", revision: "" }
      }
      return prev
    })
  }, [originalContent])

  const handleCloseWithCheck = useCallback((open: boolean) => {
    if (!open && isDirty) {
      if (window.confirm("当前文件有未保存的修改，确定要关闭吗？")) {
        onOpenChange(false)
      }
      return
    }
    onOpenChange(open)
  }, [isDirty, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleCloseWithCheck}>
      <DialogContent
        className="flex flex-col gap-0 p-0 overflow-hidden"
        style={{ width: "min(1100px, 92vw)", maxWidth: "min(1100px, 92vw)", height: "min(85vh, 900px)", maxHeight: "min(85vh, 900px)" }}
        showCloseButton={false}
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-border border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm">{fileName}</DialogTitle>
              <p className="truncate text-xs text-muted-foreground">{path}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {fileLanguage && <Badge variant="secondary" className="text-xs">{fileLanguage}</Badge>}
            <Badge variant="outline" className="text-xs text-muted-foreground">可编辑</Badge>
            {fileSize > 0 && (
              <span className="text-xs text-muted-foreground">
                {(fileSize / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
        </div>

        <DialogDescription className="sr-only">
          编辑文件 {fileName}（{path}）
        </DialogDescription>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {status.type === "loading" ? (
            <div className="flex h-full flex-col gap-3 p-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="min-h-0 flex-1 rounded" />
            </div>
          ) : status.type === "error" && !originalContent ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-destructive p-4">
              <AlertCircleIcon className="size-6" />
              <p>{status.message}</p>
            </div>
          ) : (
            <EditableCodeEditor
              path={path}
              content={draftContent}
              language={fileLanguage}
              onChange={(value) => setDraftContent(value)}
            />
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-between border-border border-t px-4 py-2.5">
          <div className="flex items-center gap-2">
            {isDirty && status.type !== "saving" && status.type !== "saved" && (
              <span className="text-xs text-amber-500 font-medium">有未保存的修改</span>
            )}
            {status.type === "saving" && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                保存中...
              </span>
            )}
            {status.type === "saved" && (
              <span className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2Icon className="size-3" />
                已保存
              </span>
            )}
            {status.type === "conflict" && (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircleIcon className="size-3" />
                {status.message}
              </span>
            )}
            {status.type === "error" && originalContent && (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircleIcon className="size-3" />
                {status.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handleCloseWithCheck(false)}>
              取消
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!isDirty || status.type === "saving"}
            >
              重置
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || status.type === "saving" || status.type === "saved" || status.type === "loading"}
            >
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
