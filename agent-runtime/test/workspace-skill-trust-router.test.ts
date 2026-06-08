import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceSkillTrustService } from "../src/runtime"
import { workspaceSkillTrustRouter } from "../src/routers/workspace-skill-trust"

async function createApp(): Promise<Hono> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-skill-trust-router-"))
  const service = new WorkspaceSkillTrustService({ dataDir })
  await service.initialize()

  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("workspaceSkillTrustService", service)
    await next()
  })
  app.route("/", workspaceSkillTrustRouter)
  return app
}

const workspace = {
  workspaceId: "workspace_router",
  backendType: "local" as const,
  rootPath: "D:\\Projects\\Router",
}

describe("workspace Skill trust router", () => {
  test("records and queries trust decisions without exposing rootPath", async () => {
    const app = await createApp()

    const decision = await app.request("/runtime/workspace-skill-trust", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace,
        skillRef: "workspace:agents:review",
        trusted: true,
        reason: "approved in UI",
      }),
    })

    expect(decision.status).toBe(200)
    const decisionBody = await decision.json()
    expect(decisionBody.record).toMatchObject({
      workspaceId: "workspace_router",
      backendType: "local",
      workspaceRootHash: expect.any(String),
      skillRef: "workspace:agents:review",
      source: "agents",
      trusted: true,
      status: "trusted",
    })
    expect(JSON.stringify(decisionBody)).not.toContain("D:\\Projects\\Router")

    const query = await app.request("/runtime/workspace-skill-trust/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace,
        skillRefs: ["workspace:agents:review", "workspace:codex:missing"],
      }),
    })

    expect(query.status).toBe(200)
    const queryBody = await query.json()
    expect(queryBody.trusts).toHaveLength(2)
    expect(queryBody.trusts).toContainEqual(expect.objectContaining({
      skillRef: "workspace:agents:review",
      trusted: true,
      status: "trusted",
    }))
    expect(queryBody.trusts).toContainEqual(expect.objectContaining({
      skillRef: "workspace:codex:missing",
      trusted: false,
      status: "untrusted",
    }))
    expect(JSON.stringify(queryBody)).not.toContain("D:\\Projects\\Router")
  })

  test("returns stable error codes for invalid requests", async () => {
    const app = await createApp()

    const invalidJson = await app.request("/runtime/workspace-skill-trust/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
    expect(invalidJson.status).toBe(400)
    await expect(invalidJson.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT" },
    })

    const invalidRef = await app.request("/runtime/workspace-skill-trust", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace,
        skillRef: "global:agents:review",
        trusted: true,
      }),
    })
    expect(invalidRef.status).toBe(400)
    const invalidRefBody = await invalidRef.json()
    expect(invalidRefBody).toMatchObject({
      error: { code: "WORKSPACE_SKILL_TRUST_REF_INVALID" },
    })
    expect(JSON.stringify(invalidRefBody)).not.toContain("D:\\Projects\\Router")
  })
})
