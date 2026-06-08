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
  it("resolves packaged Bun and service bundle paths on Windows", () => {
    const paths = resolveDistributionPaths("C:/AgentHub/dist", "win32")

    expect(paths.bunBin).toBe("C:\\AgentHub\\dist\\bun.exe")
    expect(paths.hubServerEntry).toBe("C:\\AgentHub\\dist\\hub-server\\index.js")
    expect(paths.hubServerNodeModulesDir).toBe("C:\\AgentHub\\dist\\hub-server\\node_modules")
    expect(paths.runtimeEntry).toBe("C:\\AgentHub\\dist\\agent-runtime\\index.js")
    expect(paths.runtimeNodeModulesDir).toBe("C:\\AgentHub\\dist\\agent-runtime\\node_modules")
    expect(paths.publicDir).toBe("C:\\AgentHub\\dist\\public")
  })

  it("resolves packaged Bun and service bundle paths on non-Windows platforms", () => {
    const paths = resolveDistributionPaths("/opt/agenthub", "linux")

    expect(paths.bunBin).toBe("/opt/agenthub/bun")
    expect(paths.hubServerEntry).toBe("/opt/agenthub/hub-server/index.js")
    expect(paths.hubServerNodeModulesDir).toBe("/opt/agenthub/hub-server/node_modules")
    expect(paths.runtimeEntry).toBe("/opt/agenthub/agent-runtime/index.js")
    expect(paths.runtimeNodeModulesDir).toBe("/opt/agenthub/agent-runtime/node_modules")
    expect(paths.publicDir).toBe("/opt/agenthub/public")
  })

  it("accepts a complete packaged distribution directory", async () => {
    const root = await createTempRoot()
    await writeFile(join(root, "bun.exe"), "")
    await mkdir(join(root, "hub-server"), { recursive: true })
    await writeFile(join(root, "hub-server", "index.js"), "")
    await mkdir(join(root, "hub-server", "node_modules"), { recursive: true })
    await mkdir(join(root, "agent-runtime"), { recursive: true })
    await writeFile(join(root, "agent-runtime", "index.js"), "")
    await mkdir(join(root, "agent-runtime", "node_modules"), { recursive: true })
    await mkdir(join(root, "public"))

    await expect(assertDistributionPaths(resolveDistributionPaths(root, "win32"))).resolves.toBeUndefined()
  })

  it("fails clearly when required distribution files are missing", async () => {
    const root = await createTempRoot()

    await expect(assertDistributionPaths(resolveDistributionPaths(root, "win32"))).rejects.toThrow(
      "Missing Bun runtime",
    )
  })
})
