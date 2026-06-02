import { useMemo } from "react"
import Editor from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import { useTheme } from "@/components/useTheme"
import { useEditorSettings } from "@/hooks/useEditorSettings"
import { getCodePreviewMeta } from "../../utils/code-preview"
import "../../utils/monaco-loader"

type EditableCodeEditorProps = {
  path: string
  content: string
  language?: string
  onChange?: (value: string) => void
}

export function EditableCodeEditor({ path, content, language, onChange }: EditableCodeEditorProps) {
  const { theme } = useTheme()
  const editorSettings = useEditorSettings()

  const monacoLanguage = useMemo(() => {
    if (language === "Markdown") return "markdown"
    return getCodePreviewMeta(path).monacoLanguage ?? "plaintext"
  }, [path, language])

  const resolvedTheme = useMemo(() => {
    if (theme === "system") {
      return document.documentElement.classList.contains("dark") ? "dark" : "light"
    }
    return theme
  }, [theme])

  const isMarkdown = language === "Markdown" || path.endsWith(".md")

  const options = useMemo(() => ({
    readOnly: false,
    minimap: { enabled: editorSettings.minimapEnabled },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderValidationDecorations: "on" as const,
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
    wordWrap: (isMarkdown ? "on" : editorSettings.wordWrap) as "on" | "off" | "wordWrapColumn" | "bounded",
    renderWhitespace: editorSettings.renderWhitespace,
    lineNumbers: editorSettings.lineNumbers,
    folding: editorSettings.folding,
    tabSize: editorSettings.tabSize,
    fontSize: editorSettings.fontSize,
    fontFamily: editorSettings.fontFamily || undefined,
  }), [editorSettings, isMarkdown])

  return (
    <Editor
      language={monacoLanguage}
      value={content}
      theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
      options={options}
      onChange={(value) => onChange?.(value ?? "")}
    />
  )
}
