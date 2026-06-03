import type { AgentOverride } from "@/features/agents/types"
import { buildAgentAvatarImageUrl } from "@/lib/avatar-image-url"

export type AgentAvatarAgent = {
  id: string
  name: string
  shortName?: string
  origin?: string
  executorType?: string
  capabilities?: string[]
}

export type AgentAvatarTone =
  | "amber"
  | "blue"
  | "emerald"
  | "rose"
  | "slate"
  | "teal"
  | "violet"

export type AgentAvatarIconSpec = {
  kind: "icon"
  iconName: string
  initials: string
  tone: AgentAvatarTone
}

export type AgentAvatarImageSpec = {
  kind: "image"
  initials: string
  src: string
  tone: AgentAvatarTone
}

export type AgentAvatarInitialsSpec = {
  kind: "initials"
  initials: string
  tone: AgentAvatarTone
}

export type AgentAvatarSpec =
  | AgentAvatarIconSpec
  | AgentAvatarImageSpec
  | AgentAvatarInitialsSpec

export function getAgentAvatarRenderKey(avatar: AgentAvatarSpec): string {
  if (avatar.kind === "image") {
    return `image:${avatar.src}`
  }

  return avatar.kind
}

const ALLOWED_ICONS = new Set([
  "bot", "code2", "search", "eye", "pen-line", "shield-check", "route",
  "list-checks", "file-text", "image", "music", "video", "globe",
  "database", "cloud", "server", "book-open", "message-square",
  "sparkles", "zap", "brain", "cog", "users", "user",
  "wand-sparkles", "blocks", "workflow", "git-branch",
])

const fallbackTones: AgentAvatarTone[] = [
  "violet", "blue", "emerald", "rose", "amber", "teal",
]

function takeCharacters(value: string, count: number) {
  return Array.from(value.trim()).slice(0, count).join("")
}

export function resolveInitials(agent: AgentAvatarAgent) {
  if (agent.shortName?.trim()) {
    return takeCharacters(agent.shortName, 2).toUpperCase()
  }

  const source = agent.name.trim() || agent.id
  const words = source.split(/[\s_-]+/).filter(Boolean)

  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => takeCharacters(word, 1))
      .join("")
      .toUpperCase()
  }

  return takeCharacters(words[0] ?? source, 2).toUpperCase()
}

export function hashAgentSeed(agent: AgentAvatarAgent) {
  const seed = agent.id || agent.name
  let hash = 0

  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  return hash
}

export function resolveOverrideSpec(
  override: AgentOverride,
  agent: AgentAvatarAgent,
): AgentAvatarSpec | null {
  if (override.source === "image") {
    return {
      kind: "image",
      initials: resolveInitials(agent),
      src: buildAgentAvatarImageUrl(agent.id, override.file.relativePath),
      tone: "slate",
    }
  }

  if (override.source === "icon") {
    if (!ALLOWED_ICONS.has(override.icon)) return null
    return {
      kind: "icon",
      iconName: override.icon,
      initials: resolveInitials(agent),
      tone: override.tone,
    }
  }

  if (override.source === "initials") {
    return {
      kind: "initials",
      initials: takeCharacters(override.text, 2).toUpperCase(),
      tone: override.tone,
    }
  }

  return null
}

export function resolveAgentAvatar(
  agent: AgentAvatarAgent,
  override?: AgentOverride | null,
  presets?: Record<string, AgentAvatarSpec>,
): AgentAvatarSpec {
  if (override) {
    const spec = resolveOverrideSpec(override, agent)
    if (spec) return spec
  }

  if (presets) {
    const preset = presets[agent.id.toLowerCase()]
    if (preset) return preset
  }

  return {
    initials: resolveInitials(agent),
    kind: "initials",
    tone: fallbackTones[hashAgentSeed(agent) % fallbackTones.length],
  }
}
