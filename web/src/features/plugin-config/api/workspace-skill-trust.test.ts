import { afterEach, describe, expect, test } from "bun:test"

import { workspaceSkillTrustApi } from "./workspace-skill-trust"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("workspaceSkillTrustApi", () => {
  test("queries trust records through HubServer without sending rootPath", async () => {
    const calls: Array<{ path: string; init?: RequestInit; body: unknown }> = []
    globalThis.fetch = ((path: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as unknown
      calls.push({ path: String(path), init, body })
      return Promise.resolve(new Response(JSON.stringify({
        checkedAt: "2026-06-08T00:00:00.000Z",
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          workspaceRootHash: "hash",
        },
        trusts: [],
      }), { status: 200 }))
    }) as typeof fetch

    await workspaceSkillTrustApi.query("conv_1", ["workspace:agents:review"])

    expect(calls).toEqual([{
      path: "/api/runtime/workspace-skill-trust/query",
      init: expect.objectContaining({ method: "POST" }),
      body: {
        conversationId: "conv_1",
        skillRefs: ["workspace:agents:review"],
      },
    }])
    expect(JSON.stringify(calls)).not.toContain("rootPath")
  })

  test("persists trust decisions through HubServer without sending rootPath", async () => {
    const calls: Array<{ path: string; init?: RequestInit; body: unknown }> = []
    globalThis.fetch = ((path: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as unknown
      calls.push({ path: String(path), init, body })
      return Promise.resolve(new Response(JSON.stringify({
        record: {
          workspaceId: "workspace_1",
          backendType: "local",
          workspaceRootHash: "hash",
          skillRef: "workspace:agents:review",
          source: "agents",
          trusted: true,
          status: "trusted",
          createdAt: "2026-06-08T00:00:00.000Z",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
      }), { status: 200 }))
    }) as typeof fetch

    await workspaceSkillTrustApi.decide({
      conversationId: "conv_1",
      skillRef: "workspace:agents:review",
      trusted: true,
      reason: "approved in plugin config",
    })

    expect(calls).toEqual([{
      path: "/api/runtime/workspace-skill-trust",
      init: expect.objectContaining({ method: "PUT" }),
      body: {
        conversationId: "conv_1",
        skillRef: "workspace:agents:review",
        trusted: true,
        reason: "approved in plugin config",
      },
    }])
    expect(JSON.stringify(calls)).not.toContain("rootPath")
  })
})
