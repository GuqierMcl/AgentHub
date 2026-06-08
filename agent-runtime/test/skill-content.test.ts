import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CapabilityDiscoveryService } from "../src/runtime/capabilities"
import {
  DEFAULT_MAX_SKILL_BODY_CHARS,
  SkillContentService,
} from "../src/runtime/skill-content"

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, content, "utf-8")
}

describe("SkillContentService", () => {
  test("reads a valid global Skill body without exposing absolute paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skill-content-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    const skillPath = join(homeDir, ".agents", "skills", "review", "SKILL.md")
    await writeText(skillPath, [
      "---",
      "name: Review Skill",
      "description: Review instructions",
      "---",
      "",
      "# Review",
      "Always check tests.",
    ].join("\n"))

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const service = new SkillContentService(discovery)
    const result = await service.resolve({
      skillRefs: ["global:agents:review"],
    })

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      ref: "global:agents:review",
      name: "Review Skill",
      source: "agents",
      level: "global",
      truncated: false,
    })
    expect(result.skills[0].body).toContain("Always check tests.")
    expect(JSON.stringify(result)).not.toContain(homeDir)
    expect(JSON.stringify(result)).not.toContain(skillPath)
  })

  test("skips invalid and missing Skill refs with warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skill-content-missing-"))
    const discovery = new CapabilityDiscoveryService({
      homeDir: join(root, "home"),
      dataDir: join(root, "data"),
    })
    const service = new SkillContentService(discovery)
    const result = await service.resolve({
      skillRefs: ["global:agents:missing"],
    })

    expect(result.skills).toEqual([])
    expect(result.warnings).toContain("Skill global:agents:missing was not found or is not valid.")
  })

  test("lists valid workspace Skill refs for automatic injection", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skill-content-workspace-"))
    const workspaceRoot = join(root, "workspace")
    const dataDir = join(root, "data")
    await writeText(join(workspaceRoot, ".agents", "skills", "review", "SKILL.md"), [
      "---",
      "name: Review Skill",
      "---",
      "",
      "Use local review rules.",
    ].join("\n"))
    await writeText(join(workspaceRoot, ".codex", "skills", "style", "SKILL.md"), [
      "---",
      "name: Style Skill",
      "---",
      "",
      "Use local style rules.",
    ].join("\n"))
    await writeText(join(workspaceRoot, ".claude", "skills", "broken", "SKILL.md"), [
      "---",
      "name: Broken Skill",
      "bad-frontmatter",
      "---",
      "",
      "This invalid Skill should not auto inject.",
    ].join("\n"))

    const discovery = new CapabilityDiscoveryService({
      homeDir: join(root, "home"),
      dataDir,
    })
    const service = new SkillContentService(discovery)

    await expect(service.listWorkspaceSkillRefs({
      workspaceId: "workspace_auto",
      backendType: "local",
      rootPath: workspaceRoot,
    })).resolves.toEqual([
      "workspace:agents:review",
      "workspace:codex:style",
    ])
  })

  test("truncates long Skill bodies and parses relative refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skill-content-long-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    const longBody = "x".repeat(DEFAULT_MAX_SKILL_BODY_CHARS + 500)
    await writeText(join(homeDir, ".codex", "skills", "long", "SKILL.md"), [
      "---",
      "name: Long Skill",
      "---",
      "",
      "[Guide](references/guide.md)",
      "```bash",
      "rm -rf ./tmp",
      "```",
      longBody,
    ].join("\n"))

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const service = new SkillContentService(discovery)
    const result = await service.resolve({
      skillRefs: ["global:codex:long"],
    })

    expect(result.skills[0].truncated).toBe(true)
    expect(result.skills[0].body.length).toBeLessThanOrEqual(DEFAULT_MAX_SKILL_BODY_CHARS)
    expect(result.skills[0].relativeRefs).toEqual(["references/guide.md"])
    expect(result.skills[0].warnings).toContain("Skill contains shell-like fenced code; Runtime treats it as text and does not execute it.")
  })
})
