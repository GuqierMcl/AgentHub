import { parseArgs } from "node:util"

export interface CliConfig {
  port?: number
  dataDir?: string
  logLevel?: string
  noBrowser: boolean
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid --port: ${value}`)
  }

  return port
}

export function parseCliConfig(args: string[] = Bun.argv.slice(2)): CliConfig {
  const { values } = parseArgs({
    args,
    options: {
      port: {
        type: "string",
        short: "p",
      },
      "data-dir": {
        type: "string",
        short: "d",
      },
      "log-level": {
        type: "string",
        short: "l",
      },
      "no-browser": {
        type: "boolean",
      },
    },
    strict: true,
    allowPositionals: false,
  })

  return {
    port: parsePort(values.port),
    dataDir: values["data-dir"],
    logLevel: values["log-level"],
    noBrowser: values["no-browser"] ?? false,
  }
}
