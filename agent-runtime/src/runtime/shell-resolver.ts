import { basename } from "node:path"

export type ShellCommandSyntax = "PowerShell" | "POSIX sh" | "Bash" | "cmd.exe" | "custom"

export type ResolvedRuntimeShell = {
  executable: string
  commandArgs: string[]
  displayName: string
  commandSyntax: ShellCommandSyntax
  commandPrefix?: string
}

function parseJsonStringArray(value: string | undefined): string[] | null {
  if (!value?.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed
    }
  } catch {
    return null
  }

  return null
}

function defaultShellArgs(): string[] {
  return process.platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]
    : ["-lc"]
}

function defaultPowerShellCommandPrefix(): string {
  return [
    "$agentHubUtf8 = New-Object System.Text.UTF8Encoding $false",
    "[Console]::InputEncoding = $agentHubUtf8",
    "[Console]::OutputEncoding = $agentHubUtf8",
    "$OutputEncoding = $agentHubUtf8",
  ].join("; ")
}

function inferCommandSyntax(executable: string): ShellCommandSyntax {
  const name = basename(executable).toLowerCase()
  if (name === "powershell.exe" || name === "powershell" || name === "pwsh.exe" || name === "pwsh") {
    return "PowerShell"
  }
  if (name === "cmd.exe" || name === "cmd") {
    return "cmd.exe"
  }
  if (name === "bash.exe" || name === "bash") {
    return "Bash"
  }
  if (name === "sh" || name === "sh.exe") {
    return "POSIX sh"
  }
  return "custom"
}

export function resolveRuntimeShell(): ResolvedRuntimeShell {
  const override = process.env.AGENTHUB_BASH_SHELL?.trim()
  if (override) {
    return {
      executable: override,
      commandArgs: parseJsonStringArray(process.env.AGENTHUB_BASH_SHELL_ARGS) ?? defaultShellArgs(),
      displayName: basename(override) || override,
      commandSyntax: inferCommandSyntax(override),
    }
  }

  if (process.platform === "win32") {
    return {
      executable: "powershell.exe",
      commandArgs: defaultShellArgs(),
      displayName: "powershell.exe",
      commandSyntax: "PowerShell",
      commandPrefix: defaultPowerShellCommandPrefix(),
    }
  }

  return {
    executable: "/bin/sh",
    commandArgs: defaultShellArgs(),
    displayName: "/bin/sh",
    commandSyntax: "POSIX sh",
  }
}

export function createShellCommand(shell: ResolvedRuntimeShell, command: string): string {
  return shell.commandPrefix ? `${shell.commandPrefix}; ${command}` : command
}
