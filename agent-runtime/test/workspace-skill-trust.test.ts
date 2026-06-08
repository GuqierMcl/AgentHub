import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  WorkspaceSkillTrustService,
  type WorkspaceSkillTrustWorkspace,
} from "../src/runtime"

async function createService(): Promise<{
  service: WorkspaceSkillTrustService
  dataDir: string
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-skill-trust-"))
  const service = new WorkspaceSkillTrustService({ dataDir })
  await service.initialize()
  return { service, dataDir }
}

const workspace: WorkspaceSkillTrustWorkspace = {
  workspaceId: "workspace_alpha",
  backendType: "local",
  rootPath: "D:\\Projects\\Alpha",
}

describe("WorkspaceSkillTrustService", () => {
  test("returns default trusted records without exposing workspace root paths", async () => {
    const { service } = await createService()

    const result = await service.list({
      workspace,
      skillRefs: ["workspace:agents:review"],
    })

    expect(result.trusts).toHaveLength(1)
    expect(result.trusts[0]).toMatchObject({
      workspaceId: "workspace_alpha",
      backendType: "local",
      skillRef: "workspace:agents:review",
      source: "agents",
      trusted: true,
      status: "trusted",
    })
    expect(result.trusts[0].trustedAt).toBeUndefined()
    expect(result.workspace.workspaceRootHash).toHaveLength(64)
    expect(JSON.stringify(result)).not.toContain("D:\\Projects\\Alpha")
    expect(await service.isTrusted({
      workspace,
      skillRef: "workspace:agents:review",
    })).toBe(true)
  })

  test("persists trusted and revoked workspace Skill decisions", async () => {
    const { service, dataDir } = await createService()

    const trusted = await service.decide({
      workspace,
      skillRef: "workspace:codex:review",
      trusted: true,
      reason: "user-approved",
    })

    expect(trusted.record).toMatchObject({
      skillRef: "workspace:codex:review",
      source: "codex",
      trusted: true,
      status: "trusted",
    })
    expect(await service.isTrusted({
      workspace,
      skillRef: "workspace:codex:review",
    })).toBe(true)

    const reloaded = new WorkspaceSkillTrustService({ dataDir })
    await reloaded.initialize()
    expect(await reloaded.isTrusted({
      workspace,
      skillRef: "workspace:codex:review",
    })).toBe(true)

    const revoked = await reloaded.decide({
      workspace,
      skillRef: "workspace:codex:review",
      trusted: false,
      reason: "user-revoked",
    })

    expect(revoked.record).toMatchObject({
      trusted: false,
      status: "untrusted",
    })
    expect(revoked.record.revokedAt).toBeDefined()
    expect(await reloaded.isTrusted({
      workspace,
      skillRef: "workspace:codex:review",
    })).toBe(false)

    const raw = await readFile(join(dataDir, "workspace-skill-trust.json"), "utf-8")
    expect(raw).not.toContain("D:\\Projects\\Alpha")
  })

  test("scopes explicit revokes to the workspace root hash", async () => {
    const { service } = await createService()

    await service.decide({
      workspace,
      skillRef: "workspace:agents:review",
      trusted: false,
    })

    expect(await service.isTrusted({
      workspace,
      skillRef: "workspace:agents:review",
    })).toBe(false)

    expect(await service.isTrusted({
      workspace: {
        ...workspace,
        rootPath: "D:\\Projects\\Different",
      },
      skillRef: "workspace:agents:review",
    })).toBe(true)
  })

  test("rejects global or malformed Skill refs", async () => {
    const { service } = await createService()

    await expect(service.decide({
      workspace,
      skillRef: "global:agents:review",
      trusted: true,
    })).rejects.toMatchObject({
      code: "WORKSPACE_SKILL_TRUST_REF_INVALID",
    })

    await expect(service.list({
      workspace,
      skillRefs: ["workspace:unknown:review"],
    })).rejects.toMatchObject({
      code: "WORKSPACE_SKILL_TRUST_REF_INVALID",
    })
  })
})
