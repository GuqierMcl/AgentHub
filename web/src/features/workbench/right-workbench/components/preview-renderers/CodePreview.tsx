import { useMemo } from "react"
import Editor from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import { Maximize2Icon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/useTheme"
import { useEditorSettings } from "@/hooks/useEditorSettings"
import "../../utils/monaco-loader"
import { getCodePreviewMeta } from "../../utils/code-preview"

type CodePreviewProps = {
  path: string
  name: string
  content: string
  size: number
  language?: string
  truncated?: boolean
  onFullscreen?: () => void
}

export function CodePreview({ path, content, onFullscreen }: CodePreviewProps) {
  const { theme } = useTheme()
  const editorSettings = useEditorSettings()

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

  const options = useMemo(() => ({
    readOnly: true,
    minimap: { enabled: editorSettings.minimapEnabled },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderValidationDecorations: "on" as const,
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
    wordWrap: editorSettings.wordWrap,
    renderWhitespace: editorSettings.renderWhitespace,
    lineNumbers: editorSettings.lineNumbers,
    folding: editorSettings.folding,
    tabSize: editorSettings.tabSize,
    fontSize: editorSettings.fontSize,
    fontFamily: editorSettings.fontFamily || undefined,
  }), [editorSettings])

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
        {onFullscreen && (
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onFullscreen} aria-label="全屏预览">
            <Maximize2Icon className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          language={monacoLanguage}
          value={content}
          theme={monacoTheme}
          options={options}
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
