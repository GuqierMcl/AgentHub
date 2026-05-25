import { basename, extname } from "node:path"
import type { SandboxPolicy } from "./types"

export const DEFAULT_BLOCKED_BASENAMES = [
  ".env",
  ".npmrc",
  "AGENTS.md",
  "id_rsa",
]

export const DEFAULT_BLOCKED_EXTENSIONS = [".pem", ".key"]

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  readOnly: false,
  blockSensitivePaths: true,
  allowExternalAccess: true,
  blockedBasenames: DEFAULT_BLOCKED_BASENAMES,
  blockedExtensions: DEFAULT_BLOCKED_EXTENSIONS,
}

export function isSensitiveWorkspacePath(pathValue: string, policy: SandboxPolicy): boolean {
  const normalized = pathValue.replaceAll("\\", "/")
  const segments = normalized.split("/").filter(Boolean)
  const fileName = basename(normalized)
  const lowerName = fileName.toLowerCase()
  const extension = extname(lowerName)
  const blockedBasenames = policy.blockedBasenames.map((value) => value.toLowerCase())

  if (blockedBasenames.includes(lowerName) || lowerName.startsWith(".env.")) {
    return true
  }

  if (policy.blockedExtensions.map((value) => value.toLowerCase()).includes(extension)) {
    return true
  }

  return segments.some((segment) => [".git", ".svn", ".hg"].includes(segment.toLowerCase()))
}
