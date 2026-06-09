import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentRegistry, AgentRegistryMutationError } from "./agent-registry"
import { createDefaultRuntimeToolRegistry } from "../runtime"

const tempDirs: string[] = []

const DEPLOYMENT_TOOL_NAMES = [
  "list_deploy_servers",
  "connect_deploy_server",
  "run_deploy_command",
  "update_deployment_status",
  "close_deploy_connection",
  "upload_deploy_artifact",
  "check_deployment_url",
]

async function createRegistry(): Promise<AgentRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "agenthub-deploy-agent-"))
  tempDirs.push(dir)
  const registry = new AgentRegistry(dir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Deploy preset agent", () => {
  test("exposes Deploy as a visible callable primary agent with deployment tools", async () => {
    const registry = await createRegistry()

    const deploy = registry.getAgent("deploy")

    expect(deploy).toMatchObject({
      id: "deploy",
      tier: "primary",
      visibility: "visible",
      entryPolicy: "callable",
      delegationPolicy: "terminal",
      permissionPolicy: {
        deploy: "publish",
      },
    })
    expect(deploy?.allowedTools).toEqual(expect.arrayContaining([
      ...DEPLOYMENT_TOOL_NAMES,
      "question",
      "web_fetch",
      "ls",
      "read_file",
      "glob",
      "grep",
    ]))
  })

  test("removes Deploy from Orchestrator hidden subagent delegation", async () => {
    const registry = await createRegistry()

    const orchestrator = registry.getAgent("orchestrator")

    expect(orchestrator?.allowedSubagents).not.toContain("deploy")
  })

  test("keeps deployment tools out of user custom agent authoring", async () => {
    const registry = await createRegistry()
    const options = createDefaultRuntimeToolRegistry().listUserConfigurableTools()

    expect(options.map((tool) => tool.id)).not.toEqual(
      expect.arrayContaining(DEPLOYMENT_TOOL_NAMES)
    )

    await expect(registry.createUserAgent({
      name: "Custom Deployer",
      description: "Should not be allowed to select deploy tools.",
      systemPrompt: "Try to deploy.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: ["run_deploy_command"],
      allowedSkills: [],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
      enabled: true,
    })).rejects.toBeInstanceOf(AgentRegistryMutationError)
  })
})
