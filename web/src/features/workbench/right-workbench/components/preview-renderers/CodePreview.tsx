import { useMemo } from "react"
import Editor from "@monaco-editor/react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/useTheme"
import "../../utils/monaco-loader"
import { getCodePreviewMeta } from "../../utils/code-preview"

type CodePreviewProps = {
  path: string
  name: string
  content: string
  size: number
  language?: string
  truncated?: boolean
}

const EDITOR_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  wordWrap: "off" as const,
  renderWhitespace: "selection" as const,
  lineNumbers: "on" as const,
  folding: true,
  tabSize: 2,
}

export function CodePreview({ path, content }: CodePreviewProps) {
  const { theme } = useTheme()

  const monacoLanguage = useMemo(() => {
    return getCodePreviewMeta(path).monacoLanguage ?? "plaintext"
  }, [path])

  const displayLanguage = useMemo(() => {
    return getCodePreviewMeta(path).displayLanguage ?? null
  }, [path])

  const resolvedTheme = useMemo(() => {
    if (theme === "system") {
      return document.documentElement.classList.contains("dark") ? "dark" : "light"
    }
    return theme
  }, [theme])

  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs"

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        File is empty
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-1.5">
        {displayLanguage && <Badge variant="secondary">{displayLanguage}</Badge>}
        <Badge variant="outline" className="text-muted-foreground">只读</Badge>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          language={monacoLanguage}
          value={content}
          theme={monacoTheme}
          options={EDITOR_OPTIONS}
          loading={
            <div className="flex h-full flex-col gap-3 p-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="min-h-0 flex-1 rounded" />
            </div>
          }
        />
      </div>
    </div>
  )
}
