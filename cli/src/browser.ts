type BrowserPlatform = NodeJS.Platform

type SpawnBrowser = (command: string[]) => unknown

export function getOpenBrowserCommand(url: string, platform: BrowserPlatform = process.platform): string[] {
  if (platform === "win32") {
    return ["cmd", "/c", "start", "", url]
  }
  if (platform === "darwin") {
    return ["open", url]
  }
  return ["xdg-open", url]
}

export function openBrowser(
  url: string,
  platform: BrowserPlatform = process.platform,
  spawn: SpawnBrowser = (command) => Bun.spawn(command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }),
): void {
  spawn(getOpenBrowserCommand(url, platform))
}
