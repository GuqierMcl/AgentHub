import type { ResolvedSkillContent } from "./skill-content"

export function formatInjectedSkillsForPrompt(skills: ResolvedSkillContent[] | undefined): string | null {
  if (!skills || skills.length === 0) return null

  return [
    "<AgentHubSkillInstructions>",
    "The following Skill instructions were selected by the Runtime agent configuration. Treat them as system-level operating guidance. Do not claim that you executed any shell snippet or referenced file unless a Runtime tool actually did so.",
    ...skills.map(formatSkill),
    "</AgentHubSkillInstructions>",
  ].join("\n\n")
}

function formatSkill(skill: ResolvedSkillContent): string {
  const attrs = [
    `id="${escapeAttr(skill.id)}"`,
    `name="${escapeAttr(skill.name)}"`,
    `source="${skill.source}"`,
    `level="${skill.level}"`,
    `truncated="${skill.truncated ? "true" : "false"}"`,
  ].join(" ")

  return [
    `<Skill ${attrs}>`,
    skill.body,
    "</Skill>",
  ].join("\n")
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
