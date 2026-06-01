import os from "node:os"

export type ShellConfig = {
  shell: string
  args: string[]
}

export function resolveShell(override?: string): ShellConfig {
  if (override) {
    return { shell: override, args: [] }
  }

  const platform = os.platform()

  if (platform === "win32") {
    return { shell: "powershell.exe", args: ["-NoLogo"] }
  }

  if (platform === "darwin") {
    return { shell: "/bin/zsh", args: [] }
  }

  return { shell: "/bin/bash", args: [] }
}
