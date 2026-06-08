import { useState, useCallback, useEffect, useRef } from "react"
import {
  Loader2Icon,
  FolderIcon,
  FolderOpenIcon,
  HardDriveIcon,
  CheckIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Files,
  FolderItem,
  FolderContent,
  SubFiles,
} from "@/components/animate-ui/components/radix/files"
import {
  FolderHeader as FolderHeaderPrimitive,
  FolderTrigger as FolderTriggerPrimitive,
  FolderHighlight as FolderHighlightPrimitive,
  Folder as FolderPrimitive,
  FolderIcon as FolderIconPrimitive,
  FileLabel as FileLabelPrimitive,
} from "@/components/animate-ui/primitives/radix/files"
import { workspaceBrowserApi } from "@/features/workbench/right-workbench/api/workspace-browser"
import type { WorkspaceTreeEntry } from "@/features/workbench/right-workbench/types"

// Module-level cache shared across dialog open/close cycles
const childrenCache = new Map<string, WorkspaceTreeEntry[]>()

type WorkspacePickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
}

function FolderRow({
  name,
  path,
  selected,
  loading,
  onSelect,
}: {
  name: string
  path: string
  selected: boolean
  loading?: boolean
  onSelect: (path: string) => void
}) {
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <FolderHeaderPrimitive className="min-w-0 flex-1">
        <FolderTriggerPrimitive className="min-w-0 w-full text-start">
          <FolderHighlightPrimitive>
            <FolderPrimitive className="pointer-events-none flex min-w-0 items-center gap-2 p-2">
              <FolderIconPrimitive
                className="shrink-0"
                closeIcon={<FolderIcon className="size-4.5" />}
                openIcon={<FolderOpenIcon className="size-4.5" />}
              />
              <FileLabelPrimitive
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  selected && "font-semibold text-primary",
                )}
              >
                {name}
              </FileLabelPrimitive>
            </FolderPrimitive>
          </FolderHighlightPrimitive>
        </FolderTriggerPrimitive>
      </FolderHeaderPrimitive>

      {loading ? (
        <div className="flex size-7 shrink-0 items-center justify-center">
          <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <button
          type="button"
          aria-label={selected ? `已选中 ${name}` : `选中 ${name}`}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color,background-color]",
            "opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground",
            selected && "opacity-100 text-primary hover:text-primary",
          )}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(path)
          }}
        >
          <CheckIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function LazyFolderChildren({
  path,
  selectedPath,
  onSelect,
  loadingFolders,
}: {
  path: string
  selectedPath: string | null
  onSelect: (path: string) => void
  loadingFolders: ReadonlySet<string>
}) {
  const [children, setChildren] = useState<WorkspaceTreeEntry[] | null>(
    () => childrenCache.get(path) ?? null,
  )

  useEffect(() => {
    if (children !== null) return
    let cancelled = false
    workspaceBrowserApi
      .browseDirectory(path)
      .then((data) => {
        const dirs = data.entries.filter((e) => e.kind === "dir")
        childrenCache.set(path, dirs)
        if (!cancelled) setChildren(dirs)
      })
      .catch(() => {
        if (!cancelled) setChildren([])
      })
    return () => { cancelled = true }
  }, [path, children])

  if (!children) {
    return (
      <div className="flex items-center py-1 px-2">
        <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (children.length === 0) {
    return <div className="py-1 px-2 text-[10px] text-muted-foreground">(空目录)</div>
  }

  return children.map((child) => (
    <FolderItem key={child.path} value={child.path}>
      <FolderRow
        name={child.name}
        path={child.path}
        selected={selectedPath === child.path}
        loading={loadingFolders.has(child.path)}
        onSelect={onSelect}
      />
      <FolderContent>
        <SubFiles>
          <LazyFolderChildren
            path={child.path}
            selectedPath={selectedPath}
            onSelect={onSelect}
            loadingFolders={loadingFolders}
          />
        </SubFiles>
      </FolderContent>
    </FolderItem>
  ))
}

export function WorkspacePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: WorkspacePickerDialogProps) {
  const [rootEntries, setRootEntries] = useState<WorkspaceTreeEntry[] | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [openValues, setOpenValues] = useState<string[]>([])
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set())
  const openValuesRef = useRef<string[]>([])
  const rootCacheRef = useRef<WorkspaceTreeEntry[] | null>(null)

  const rootLoading = open && rootEntries === null

  // Keep ref in sync for handleOpenChange closure
  useEffect(() => {
    openValuesRef.current = openValues
  }, [openValues])

  useEffect(() => {
    if (!open) return
    // Use cached root entries if available
    if (rootCacheRef.current) {
      setRootEntries(rootCacheRef.current)
      return
    }
    workspaceBrowserApi
      .browseDirectory()
      .then((data) => {
        const entries = data.entries.filter((e) => e.kind === "dir")
        rootCacheRef.current = entries
        setRootEntries(entries)
      })
      .catch(() => {
        rootCacheRef.current = []
        setRootEntries([])
      })
  }, [open])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      // Keep root cache via rootCacheRef, only reset transient state
      setSelectedPath(null)
      setOpenValues([])
      setLoadingFolders(new Set())
    }
    if (open) return
    onOpenChange(open)
  }, [onOpenChange])

  const handleOpenChange = useCallback((newValues: string[]) => {
    const prev = openValuesRef.current
    const newlyOpened = newValues.find((v) => !prev.includes(v))

    if (newlyOpened && !childrenCache.has(newlyOpened)) {
      // Not cached → show spinner, fetch, then expand
      setLoadingFolders((prevLoading) => new Set(prevLoading).add(newlyOpened))
      workspaceBrowserApi
        .browseDirectory(newlyOpened)
        .then((data) => {
          const dirs = data.entries.filter((e) => e.kind === "dir")
          childrenCache.set(newlyOpened, dirs)
          setLoadingFolders((prevLoading) => {
            const next = new Set(prevLoading)
            next.delete(newlyOpened)
            return next
          })
          setOpenValues((prevOpen) => [...prevOpen, newlyOpened])
        })
        .catch(() => {
          setLoadingFolders((prevLoading) => {
            const next = new Set(prevLoading)
            next.delete(newlyOpened)
            return next
          })
        })
      return // Don't expand yet
    }

    openValuesRef.current = newValues
    setOpenValues(newValues)
  }, [])

  const handleConfirm = useCallback(() => {
    if (selectedPath) {
      onSelect(selectedPath)
      handleDialogOpenChange(false)
    }
  }, [selectedPath, onSelect, handleDialogOpenChange])

  const handleFolderSelect = useCallback((path: string) => {
    setSelectedPath(path)
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        from="top"
        className="flex max-h-[75vh] w-[600px] flex-col overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>选择工作区</DialogTitle>
          <DialogDescription className="sr-only">
            选择一个工作区文件夹并确认，用于为新会话关联本地项目目录。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <div className="px-1 py-1">
              {rootLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : rootEntries && rootEntries.length > 0 ? (
                <Files
                  open={openValues}
                  onOpenChange={handleOpenChange}
                  style={{ overflowY: "visible" }}
                >
                  {rootEntries.map((entry) => (
                    <FolderItem key={entry.path} value={entry.path}>
                      <FolderRow
                        name={entry.name}
                        path={entry.path}
                        selected={selectedPath === entry.path}
                        loading={loadingFolders.has(entry.path)}
                        onSelect={handleFolderSelect}
                      />
                      <FolderContent>
                        <SubFiles>
                          <LazyFolderChildren
                            path={entry.path}
                            selectedPath={selectedPath}
                            onSelect={handleFolderSelect}
                            loadingFolders={loadingFolders}
                          />
                        </SubFiles>
                      </FolderContent>
                    </FolderItem>
                  ))}
                </Files>
              ) : rootEntries && rootEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <HardDriveIcon className="mb-2 size-8 opacity-40" />
                  <p className="text-xs">未找到可访问的目录</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            <span
              className={cn(
                "flex-1 min-w-0 truncate text-xs",
                selectedPath ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {selectedPath || "请选择一个文件夹"}
            </span>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-6 pt-2 pb-6">
          <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedPath}>
            确认选择
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
