import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  assertDistributionPaths,
  resolveDistributionPaths,
} from "./distribution"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = join(tmpdir(), `agenthub-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  tempRoots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("distribution paths", () => {
  it("uses .exe sibling binaries on Windows", () => {
    const paths = resolveDistributionPaths("C:/AgentHub/dist", "win32")

    expect(paths.hubServerBin).toBe("C:\\AgentHub\\dist\\hub-server.exe")
    expect(paths.runtimeBin).toBe("C:\\AgentHub\\dist\\agent-runtime.exe")
    expect(paths.publicDir).toBe("C:\\AgentHub\\dist\\public")
  })

  it("uses extensionless sibling binaries on non-Windows platforms", () => {
    const paths = resolveDistributionPaths("/opt/agenthub", "linux")

    expect(paths.hubServerBin).toBe("/opt/agenthub/hub-server")
    expect(paths.runtimeBin).toBe("/opt/agenthub/agent-runtime")
    expect(paths.publicDir).toBe("/opt/agenthub/public")
  })

  it("accepts a complete flat distribution directory", async () => {
    const root = await createTempRoot()
    await writeFile(join(root, "hub-server.exe"), "")
    await writeFile(join(root, "agent-runtime.exe"), "")
    await mkdir(join(root, "public"))

    await expect(assertDistributionPaths(resolveDistributionPaths(root, "win32"))).resolves.toBeUndefined()
  })

  it("fails clearly when required distribution files are missing", async () => {
    const root = await createTempRoot()

    await expect(assertDistributionPaths(resolveDistributionPaths(root, "win32"))).rejects.toThrow(
      "Missing HubServer binary",
    )
  })
})
