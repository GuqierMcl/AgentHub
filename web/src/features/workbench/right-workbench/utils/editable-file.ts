const EDITABLE_EXTENSIONS = new Set([
  // Code files
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".css", ".scss", ".less", ".html", ".htm",
  ".json", ".py", ".java", ".go", ".rs",
  ".sh", ".bash", ".zsh", ".ps1", ".sql",
  // Config files
  ".yml", ".yaml", ".toml", ".env", ".ini", ".cfg", ".conf", ".xml",
  ".prisma", ".graphql", ".gql",
  ".gitignore", ".dockerignore", ".editorconfig",
  // Plain text
  ".txt", ".md", ".log", ".csv",
])

export function isEditableFile(path: string): boolean {
  const name = path.split("/").pop() ?? path
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0) return false
  const ext = name.slice(dotIndex).toLowerCase()
  return EDITABLE_EXTENSIONS.has(ext)
}

export const EDITABLE_MAX_SIZE = 1024 * 1024 // 1MB
