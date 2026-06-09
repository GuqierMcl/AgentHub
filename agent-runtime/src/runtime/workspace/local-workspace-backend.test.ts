import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { LocalWorkspaceBackend } from "./local-workspace-backend"

let workspaceRoot: string | null = null

afterEach(async () => {
  if (!workspaceRoot) {
    return
  }

  const resolvedRoot = resolve(workspaceRoot)
  const expectedPrefix = resolve(tmpdir(), "agenthub-edit-diff-")
  if (!resolvedRoot.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to clean unexpected test directory: ${resolvedRoot}`)
  }

  await rm(resolvedRoot, { recursive: true, force: true })
  workspaceRoot = null
})

describe("LocalWorkspaceBackend editFile", () => {
  it("returns a workspace-relative unified diff for successful edits", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "agenthub-edit-diff-"))
    await writeFile(
      join(workspaceRoot, "example.ts"),
      [
        "export const answer = 41",
        "export const label = 'draft'",
        "",
      ].join("\n"),
      "utf-8"
    )

    const backend = new LocalWorkspaceBackend(workspaceRoot)
    const result = await backend.editFile("example.ts", {
      search: "export const answer = 41",
      replace: "export const answer = 42",
    })

    expect(result).toMatchObject({
      path: "example.ts",
      replacements: 1,
      changed: true,
      diff: {
        format: "unified",
        truncated: false,
        contextLines: 3,
      },
    })
    expect(result.diff?.text).toContain("diff --git a/example.ts b/example.ts")
    expect(result.diff?.text).toContain("--- a/example.ts")
    expect(result.diff?.text).toContain("+++ b/example.ts")
    expect(result.diff?.text).toContain("-export const answer = 41")
    expect(result.diff?.text).toContain("+export const answer = 42")
    expect(result.diff?.additions).toBe(1)
    expect(result.diff?.deletions).toBe(1)
  })
})
