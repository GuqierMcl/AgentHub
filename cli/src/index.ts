import { dirname } from "node:path"
import { parseCliConfig } from "./config"
import {
  assertDistributionPaths,
  resolveDistributionPaths,
} from "./distribution"
import { findAvailablePort } from "./port"
import {
  shutdownHubServer,
  startHubServer,
  type RunningHubServer,
} from "./hub-runner"
import { openBrowser } from "./browser"

async function main(): Promise<void> {
  const config = parseCliConfig()
  const baseDir = dirname(process.execPath)
  const paths = resolveDistributionPaths(baseDir)
  await assertDistributionPaths(paths)

  const port = config.port ?? await findAvailablePort()
  const running = await startHubServer({
    port,
    paths,
    dataDir: config.dataDir,
    logLevel: config.logLevel,
  })

  console.log(`AgentHub running at ${running.url}`)

  if (!config.noBrowser) {
    try {
      openBrowser(running.url)
    } catch (err) {
      console.warn("Failed to open browser automatically", err)
    }
  }

  installSignalHandlers(running)
  const exitCode = await running.process.exited
  process.exit(exitCode ?? 0)
}

function installSignalHandlers(running: RunningHubServer): void {
  let shuttingDown = false
  const forward = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    shutdownHubServer(running.process, signal)
      .then((exitCode) => process.exit(exitCode ?? 0))
      .catch((err) => {
        console.error("Failed to stop HubServer", err)
        process.exit(1)
      })
  }

  process.on("SIGINT", () => forward("SIGINT"))
  process.on("SIGTERM", () => forward("SIGTERM"))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
