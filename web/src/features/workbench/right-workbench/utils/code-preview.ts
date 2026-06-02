export const DEFAULT_MAX_MONACO_SIZE = 500 * 1024
export const DEFAULT_MAX_LINE_COUNT = 20000
export const DEFAULT_MAX_LINE_LENGTH = 20000

type CodePreviewMeta = {
  isCodeLike: boolean
  displayLanguage: string | null
  monacoLanguage: string | null
}

const EXTENSION_MAP: Record<string, { display: string; monaco: string }> = {
  ".ts": { display: "TypeScript", monaco: "typescript" },
  ".tsx": { display: "TSX", monaco: "typescript" },
  ".js": { display: "JavaScript", monaco: "javascript" },
  ".jsx": { display: "JSX", monaco: "javascript" },
  ".mjs": { display: "ES Module", monaco: "javascript" },
  ".cjs": { display: "CommonJS", monaco: "javascript" },
  ".json": { display: "JSON", monaco: "json" },
  ".css": { display: "CSS", monaco: "css" },
  ".scss": { display: "SCSS", monaco: "scss" },
  ".less": { display: "Less", monaco: "less" },
  ".html": { display: "HTML", monaco: "html" },
  ".htm": { display: "HTML", monaco: "html" },
  ".py": { display: "Python", monaco: "python" },
  ".java": { display: "Java", monaco: "java" },
  ".go": { display: "Go", monaco: "go" },
  ".rs": { display: "Rust", monaco: "rust" },
  ".sh": { display: "Shell", monaco: "shell" },
  ".bash": { display: "Bash", monaco: "shell" },
  ".zsh": { display: "Zsh", monaco: "shell" },
  ".ps1": { display: "PowerShell", monaco: "powershell" },
  ".sql": { display: "SQL", monaco: "sql" },
  ".yaml": { display: "YAML", monaco: "yaml" },
  ".yml": { display: "YAML", monaco: "yaml" },
  ".toml": { display: "TOML", monaco: "plaintext" },
  ".xml": { display: "XML", monaco: "xml" },
  ".graphql": { display: "GraphQL", monaco: "graphql" },
  ".gql": { display: "GraphQL", monaco: "graphql" },
  ".prisma": { display: "Prisma", monaco: "plaintext" },
  ".env": { display: "Env", monaco: "plaintext" },
  ".gitignore": { display: "Git Ignore", monaco: "plaintext" },
  ".dockerignore": { display: "Docker Ignore", monaco: "plaintext" },
  ".editorconfig": { display: "EditorConfig", monaco: "plaintext" },
}

function getExtension(path: string): string {
  const name = path.split("/").pop() ?? path
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0) return ""
  const ext = name.slice(dotIndex).toLowerCase()
  return ext
}

export function isMarkdownFile(path: string, language?: string): boolean {
  if (language === "Markdown") return true
  return getExtension(path) === ".md"
}

export function getCodePreviewMeta(path: string): CodePreviewMeta {
  const ext = getExtension(path)
  const entry = EXTENSION_MAP[ext]
  if (!entry) {
    return { isCodeLike: false, displayLanguage: null, monacoLanguage: null }
  }
  return {
    isCodeLike: true,
    displayLanguage: entry.display,
    monacoLanguage: entry.monaco,
  }
}

export type ShouldUseMonacoParams = {
  path: string
  size: number
  truncated?: boolean
  content?: string
  maxSize?: number
  maxLineCount?: number
  maxLineLength?: number
}

export function shouldUseMonaco({
  path,
  size,
  truncated,
  content,
  maxSize = DEFAULT_MAX_MONACO_SIZE,
  maxLineCount = DEFAULT_MAX_LINE_COUNT,
  maxLineLength = DEFAULT_MAX_LINE_LENGTH,
}: ShouldUseMonacoParams): boolean {
  const meta = getCodePreviewMeta(path)
  if (!meta.isCodeLike) return false

  if (truncated) return false

  if (size > maxSize) return false

  if (content) {
    const lines = content.split("\n")
    if (lines.length > maxLineCount) return false
    for (const line of lines) {
      if (line.length > maxLineLength) return false
    }
  }

  return true
}
