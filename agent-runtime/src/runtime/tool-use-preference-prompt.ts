const WORKSPACE_TOOL_NAMES = [
  "ls",
  "read_file",
  "glob",
  "grep",
  "write_file",
  "edit_file",
] as const

const SHELL_FALLBACK_TOOL_NAMES = ["bash"] as const

export function formatWorkspaceToolPreferenceForPrompt(options: {
  allowedTools: string[]
  workspaceBound: boolean
}): string {
  if (!options.workspaceBound) {
    return ""
  }

  const allowedToolSet = new Set(options.allowedTools)
  const workspaceTools = WORKSPACE_TOOL_NAMES.filter((toolName) => allowedToolSet.has(toolName))
  if (workspaceTools.length === 0) {
    return ""
  }

  const shellFallbackTools = SHELL_FALLBACK_TOOL_NAMES.filter((toolName) => allowedToolSet.has(toolName))
  const shellFallbackLine = shellFallbackTools.length > 0
    ? `- Use ${shellFallbackTools.join(", ")} only when the workspace tools cannot complete the requirement, such as running project scripts, package managers, tests, builds, or commands that are not expressible through workspace tools.`
    : "- If the workspace tools cannot complete the requirement, use another available tool only when it directly fits the task."

  return [
    "Workspace tool preference:",
    `- Prefer AgentHub workspace tools (${workspaceTools.join(", ")}) for workspace file discovery, reading, searching, and edits.`,
    shellFallbackLine,
  ].join("\n")
}
