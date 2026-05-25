import { useMemo, useState } from "react"
import { FileTextIcon, FolderOpenIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { defaultSelectedFilePath, workspaceFiles } from "../mock-data"

export function FileBrowserPanel() {
  const [query, setQuery] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [selectedFilePath, setSelectedFilePath] = useState(
    defaultSelectedFilePath
  )

  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return workspaceFiles
    }

    return workspaceFiles.filter((file) =>
      `${file.path} ${file.group}`.toLowerCase().includes(normalizedQuery)
    )
  }, [query])

  const groups = useMemo(
    () => Array.from(new Set(filteredFiles.map((file) => file.group))),
    [filteredFiles]
  )

  const selectedFile =
    workspaceFiles.find((file) => file.path === selectedFilePath) ??
    workspaceFiles.find((file) => file.path === defaultSelectedFilePath) ??
    workspaceFiles[0]
  const draftValue = drafts[selectedFile.path] ?? selectedFile.preview

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-border border-b p-3">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="size-4 text-primary" />
          <div className="min-w-0">
            <h3 className="truncate font-medium text-sm">文件浏览</h3>
            <p className="truncate text-muted-foreground text-xs">
              静态文件树和二次编辑入口
            </p>
          </div>
        </div>
        <Input
          className="mt-3 h-8 text-xs"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索文件..."
          value={query}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section className="space-y-2">
            {groups.map((group) => (
              <div className="space-y-1" key={group}>
                <div className="px-1 text-muted-foreground text-xs">
                  {group}
                </div>
                {filteredFiles
                  .filter((file) => file.group === group)
                  .map((file) => {
                    const selected = file.path === selectedFile.path

                    return (
                      <Button
                        className={cn(
                          "h-auto w-full justify-start gap-2 rounded-md px-2 py-2 text-left",
                          selected && "bg-muted"
                        )}
                        key={file.path}
                        onClick={() => setSelectedFilePath(file.path)}
                        type="button"
                        variant="ghost"
                      >
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">{file.name}</div>
                          <div className="truncate text-muted-foreground text-[11px]">
                            {file.path}
                          </div>
                        </div>
                        <Badge
                          className="shrink-0"
                          variant={file.status === "clean" ? "outline" : "secondary"}
                        >
                          {file.status}
                        </Badge>
                      </Button>
                    )
                  })}
              </div>
            ))}
          </section>

          <Separator />

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-medium text-sm">
                  {selectedFile.name}
                </h3>
                <p className="truncate text-muted-foreground text-xs">
                  {selectedFile.language} · cached draft
                </p>
              </div>
              <Badge variant="outline">{selectedFile.status}</Badge>
            </div>
            <Textarea
              className="min-h-64 resize-none font-mono text-xs leading-5"
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [selectedFile.path]: event.currentTarget.value,
                }))
              }
              spellCheck={false}
              value={draftValue}
            />
          </section>
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-t p-3">
        <Button size="sm" type="button" variant="outline">
          保存草稿
        </Button>
        <Button size="sm" type="button">打开审查</Button>
      </div>
    </div>
  )
}
