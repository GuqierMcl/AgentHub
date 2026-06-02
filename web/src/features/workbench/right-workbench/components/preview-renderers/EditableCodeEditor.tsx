import { useMemo } from "react"
import Editor from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import { useTheme } from "@/components/useTheme"
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

  const options = {
    readOnly: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderValidationDecorations: "on" as const,
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
    wordWrap: (isMarkdown ? "on" : "off") as "on" | "off",
    renderWhitespace: "selection" as const,
    lineNumbers: "on" as const,
    folding: true,
    tabSize: 2,
  }

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
