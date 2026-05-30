import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import {
  FolderOpenIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from "lucide-react"

import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderContent,
  FileItem,
  SubFiles,
} from "@/components/animate-ui/components/radix/files"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { workspaceBrowserApi } from "../api/workspace-browser"
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store"
import { useFileBrowserStore } from "@/features/workbench/store/file-browser-store"
import type { WorkspaceTreeEntry } from "../types"
import { WorkspacePreviewPane } from "./WorkspacePreviewPane"

// ── Search tree builder ──

type SearchTreeNode = {
  name: string
  path: string
  kind: "file" | "dir"
  isMatch: boolean
  children: Map<string, SearchTreeNode>
}

function buildSearchTree(entries: WorkspaceTreeEntry[]): SearchTreeNode {
  const root: SearchTreeNode = { name: "$root", path: "", kind: "dir", isMatch: false, children: new Map() }

  for (const entry of entries) {
    const parts = entry.path.split("/")
    let current = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const fullPath = parts.slice(0, i + 1).join("/")
      const isLast = i === parts.length - 1

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: fullPath,
          kind: isLast ? entry.kind : "dir",
          isMatch: isLast,
          children: new Map(),
        })
      } else if (isLast) {
        const existing = current.children.get(part)!
        existing.isMatch = true
        existing.kind = entry.kind
      }
      if (isLast) break
      current = current.children.get(part)!
    }
  }
  return root
}

function getAllFolderPaths(node: SearchTreeNode): string[] {
  const paths: string[] = []
  for (const child of node.children.values()) {
    if (child.kind === "dir") {
      paths.push(child.path)
      paths.push(...getAllFolderPaths(child))
    }
  }
  return paths
}

// ── Recursive Files tree node renderer ──

function RenderTreeNodes({
  entries,
  selectedPath,
  onClickFile,
  isSearchMode,
}: {
  entries: WorkspaceTreeEntry[]
  selectedPath: string | null
  onClickFile: (path: string) => void
  isSearchMode: boolean
}) {
  const dirs = entries.filter((e) => e.kind === "dir")
  const files = entries.filter((e) => e.kind === "file")

  return (
    <>
      {dirs.map((dir) => (
        <FolderItem key={dir.path} value={dir.path}>
          <FolderTrigger className="cursor-pointer w-full text-left text-xs">
            {dir.name}
          </FolderTrigger>
          <FolderContent>
            <SubFiles>
              <LazyFolderChildren
                path={dir.path}
                selectedPath={selectedPath}
                onClickFile={onClickFile}
                isSearchMode={isSearchMode}
              />
            </SubFiles>
          </FolderContent>
        </FolderItem>
      ))}
      {files.map((file) => (
        <FileItem
          key={file.path}
          className={cn(
            "cursor-pointer text-xs",
            selectedPath === file.path && "bg-accent rounded-lg",
          )}
          onClick={() => onClickFile(file.path)}
        >
          {file.name}
        </FileItem>
      ))}
    </>
  )
}

function LazyFolderChildren({
  path,
  selectedPath,
  onClickFile,
  isSearchMode,
}: {
  path: string
  selectedPath: string | null
  onClickFile: (path: string) => void
  isSearchMode: boolean
}) {
  const store = useFileBrowserStore()
  const activeConversationId = useWorkbenchStore((s) => s.activeConversationId)
  const state = activeConversationId ? store.getState(activeConversationId) : null
  const entries = state?.treeNodes[path]

  useEffect(() => {
    if (!activeConversationId || entries) return
    let cancelled = false
    workspaceBrowserApi.listTree(activeConversationId, path).then((data) => {
      if (!cancelled) {
        store.loadTreeNodes(activeConversationId, path, data.entries)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeConversationId, path, entries, store])

  if (!entries) {
    return <Loader2Icon className="size-3 animate-spin ml-2 mt-1" />
  }

  return (
    <RenderTreeNodes
      entries={entries}
      selectedPath={selectedPath}
      onClickFile={onClickFile}
      isSearchMode={isSearchMode}
    />
  )
}

// ── Search result tree ──

function SearchResultTree({
  entries,
  selectedPath,
  onClickFile,
}: {
  entries: WorkspaceTreeEntry[]
  selectedPath: string | null
  onClickFile: (path: string) => void
}) {
  const treeRoot = useMemo(() => buildSearchTree(entries), [entries])
  const allDirs = useMemo(() => getAllFolderPaths(treeRoot), [treeRoot])
  const [openValues, setOpenValues] = useState<string[]>(allDirs)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOpenValues(getAllFolderPaths(buildSearchTree(entries)))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [entries])

  function renderNode(node: SearchTreeNode) {
    const children = Array.from(node.children.values())
    return children.map((child) => {
      if (child.kind === "dir") {
        return (
          <FolderItem key={child.path} value={child.path}>
            <FolderTrigger className={cn(
              "cursor-pointer w-full text-left text-xs",
              child.isMatch && "font-semibold",
            )}>
              {child.name}
            </FolderTrigger>
            <FolderContent>
              <SubFiles>
                {renderNode(child)}
              </SubFiles>
            </FolderContent>
          </FolderItem>
        )
      }
      return (
        <FileItem
          key={child.path}
          className={cn(
            "cursor-pointer text-xs font-semibold",
            selectedPath === child.path && "bg-accent rounded-lg",
          )}
          onClick={() => onClickFile(child.path)}
        >
          {child.name}
        </FileItem>
      )
    })
  }

  return (
    <Files open={openValues} onOpenChange={setOpenValues}>
      {renderNode(treeRoot)}
    </Files>
  )
}

// ── Regular tree ──

function RegularTree({
  conversationId,
  selectedPath,
  onClickFile,
}: {
  conversationId: string
  selectedPath: string | null
  onClickFile: (path: string) => void
}) {
  const store = useFileBrowserStore()
  const state = store.getState(conversationId)
  const entries = state.treeNodes["."]

  useEffect(() => {
    if (entries) return
    let cancelled = false
    workspaceBrowserApi.listTree(conversationId, ".").then((data) => {
      if (!cancelled) {
        store.loadTreeNodes(conversationId, ".", data.entries)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [conversationId, entries, store])

  if (!entries) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Files>
      <RenderTreeNodes
        entries={entries}
        selectedPath={selectedPath}
        onClickFile={onClickFile}
        isSearchMode={false}
      />
    </Files>
  )
}

// ── Main FileBrowserPanel ──

export function FileBrowserPanel() {
  const activeConversationId = useWorkbenchStore((s) => s.activeConversationId)
  const fileStore = useFileBrowserStore()

  const state = useMemo(() => {
    if (!activeConversationId) return null
    return fileStore.getState(activeConversationId)
  }, [activeConversationId, fileStore])

  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<WorkspaceTreeEntry[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSearchMode = searchQuery.trim().length > 0

  const handleSetQuery = useCallback((query: string) => {
    setSearchQuery(query)
    if (!activeConversationId) return
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchLoading(true)
      workspaceBrowserApi.search(activeConversationId, query).then((data) => {
        setSearchResults(data.entries)
        setSearchLoading(false)
      }).catch(() => {
        setSearchResults([])
        setSearchLoading(false)
      })
    }, 300)
  }, [activeConversationId])

  const handleSelectFile = useCallback((path: string) => {
    if (!activeConversationId) return
    fileStore.setSelectedPath(activeConversationId, path)
  }, [activeConversationId, fileStore])

  if (!activeConversationId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        未选择会话
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background w-full">
      <div className="shrink-0 border-border border-b p-3">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="size-4 text-primary" />
          <div className="min-w-0">
            <h3 className="truncate font-medium text-sm">文件浏览</h3>
            <p className="truncate text-muted-foreground text-xs">工作区文件树与预览</p>
          </div>
        </div>
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ResizablePanel defaultSize={65} minSize={30} className="min-w-0">
          <div className="flex h-full min-w-0 flex-col border-border border-r">
            <div className="shrink-0 flex items-center gap-2 p-2 border-border border-b">
              <span className="text-xs text-muted-foreground truncate">
                {state.selectedPath ? state.selectedPath : "未选择文件"}
              </span>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
              <WorkspacePreviewPane
                key={state.selectedPath ?? "no-file"}
                conversationId={activeConversationId}
                selectedPath={state.selectedPath}
              />
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize={35} minSize={20} className="min-w-0">
          <div className="flex h-full min-w-0 flex-col">
            <div className="shrink-0 p-2 border-border border-b">
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-7 pl-8 pr-7 text-xs"
                  placeholder="搜索文件..."
                  value={searchQuery}
                  onChange={(e) => handleSetQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => handleSetQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
              <div className="py-1 px-1">
                {isSearchMode ? (
                  searchLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : searchResults && searchResults.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      无匹配结果
                    </p>
                  ) : searchResults ? (
                    <SearchResultTree
                      entries={searchResults}
                      selectedPath={state.selectedPath}
                      onClickFile={handleSelectFile}
                    />
                  ) : null
                ) : (
                  <RegularTree
                    conversationId={activeConversationId}
                    selectedPath={state.selectedPath}
                    onClickFile={handleSelectFile}
                  />
                )}
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
