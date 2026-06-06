import type { ComponentProps } from "react"
import {
  Code2Icon,
  ListChecksIcon,
  PenLineIcon,
  RouteIcon,
  ShieldCheckIcon,
  BotIcon,
  SearchIcon,
  EyeIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
  GlobeIcon,
  DatabaseIcon,
  CloudIcon,
  ServerIcon,
  BookOpenIcon,
  MessageSquareIcon,
  SparklesIcon,
  ZapIcon,
  BrainIcon,
  CogIcon,
  UsersIcon,
  UserIcon,
  WandSparklesIcon,
  BlocksIcon,
  WorkflowIcon,
  GitBranchIcon,
  type LucideIcon,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { buildAgentAvatarImageUrl } from "@/lib/avatar-image-url"
import { getAgentAvatarRenderKey } from "@/lib/avatar-resolve"
import type { AgentOverride } from "@/features/agents/types"

export type AgentAvatarAgent = {
  id: string
  name: string
  shortName?: string
  origin?: string
  executorType?: string
  capabilities?: string[]
}

type AgentAvatarTone =
  | "amber"
  | "blue"
  | "emerald"
  | "rose"
  | "slate"
  | "teal"
  | "violet"

type AgentAvatarIconSpec = {
  kind: "icon"
  icon: LucideIcon
  initials: string
  tone: AgentAvatarTone
}

type AgentAvatarImageSpec = {
  kind: "image"
  initials: string
  src: string
  tone: AgentAvatarTone
}

type AgentAvatarInitialsSpec = {
  kind: "initials"
  initials: string
  tone: AgentAvatarTone
}

export type AgentAvatarSpec =
  | AgentAvatarIconSpec
  | AgentAvatarImageSpec
  | AgentAvatarInitialsSpec

export type AgentAvatarProps = Omit<
  ComponentProps<typeof Avatar>,
  "children" | "size"
> & {
  agent: AgentAvatarAgent
  size?: "default" | "lg" | "sm"
  override?: AgentOverride | null
}

export const avatarPresets: Record<string, AgentAvatarSpec> = {
  coder: {
    icon: Code2Icon,
    initials: "CO",
    kind: "icon",
    tone: "blue",
  },
  opencode: {
    initials: "OC",
    kind: "image",
    src: "/agent-icons/opencode.svg",
    tone: "slate",
  },
  "claude-code": {
    initials: "CC",
    kind: "image",
    src: "/agent-icons/claudecode-color.svg",
    tone: "slate",
  },
  codex: {
    initials: "CX",
    kind: "image",
    src: "/agent-icons/codex-color.svg",
    tone: "slate",
  },
  orchestrator: {
    icon: RouteIcon,
    initials: "OR",
    kind: "icon",
    tone: "teal",
  },
  planner: {
    icon: ListChecksIcon,
    initials: "PL",
    kind: "icon",
    tone: "amber",
  },
  reviewer: {
    icon: ShieldCheckIcon,
    initials: "RV",
    kind: "icon",
    tone: "emerald",
  },
  writer: {
    icon: PenLineIcon,
    initials: "WR",
    kind: "icon",
    tone: "rose",
  },
}

const fallbackTones: AgentAvatarTone[] = [
  "violet",
  "blue",
  "emerald",
  "rose",
  "amber",
  "teal",
]

export const avatarToneClassNames: Record<AgentAvatarTone, string> = {
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  blue: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  slate: "bg-muted text-muted-foreground",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
}

export const iconNameToComponent: Record<string, LucideIcon> = {
  bot: BotIcon,
  code2: Code2Icon,
  search: SearchIcon,
  eye: EyeIcon,
  "pen-line": PenLineIcon,
  "shield-check": ShieldCheckIcon,
  route: RouteIcon,
  "list-checks": ListChecksIcon,
  "file-text": FileTextIcon,
  image: ImageIcon,
  music: MusicIcon,
  video: VideoIcon,
  globe: GlobeIcon,
  database: DatabaseIcon,
  cloud: CloudIcon,
  server: ServerIcon,
  "book-open": BookOpenIcon,
  "message-square": MessageSquareIcon,
  sparkles: SparklesIcon,
  zap: ZapIcon,
  brain: BrainIcon,
  cog: CogIcon,
  users: UsersIcon,
  user: UserIcon,
  "wand-sparkles": WandSparklesIcon,
  blocks: BlocksIcon,
  workflow: WorkflowIcon,
  "git-branch": GitBranchIcon,
}

function takeCharacters(value: string, count: number) {
  return Array.from(value.trim()).slice(0, count).join("")
}

function resolveInitials(agent: AgentAvatarAgent) {
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

function hashAgentSeed(agent: AgentAvatarAgent) {
  const seed = agent.id || agent.name
  let hash = 0

  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  return hash
}

function resolveOverrideSpec(
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
    const IconComponent = iconNameToComponent[override.icon]
    if (!IconComponent) return null
    return {
      kind: "icon",
      icon: IconComponent,
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

function resolveAgentAvatar(
  agent: AgentAvatarAgent,
  override?: AgentOverride | null,
): AgentAvatarSpec {
  if (override) {
    const spec = resolveOverrideSpec(override, agent)
    if (spec) return spec
  }

  const preset = avatarPresets[agent.id.toLowerCase()]

  if (preset) {
    return preset
  }

  return {
    initials: resolveInitials(agent),
    kind: "initials",
    tone: fallbackTones[hashAgentSeed(agent) % fallbackTones.length],
  }
}

export function AgentAvatar({
  agent,
  className,
  size = "default",
  override,
  ...props
}: AgentAvatarProps) {
  const avatar = resolveAgentAvatar(agent, override)
  const fallbackClassName = cn(
    "font-semibold group-data-[size=lg]/avatar:text-base [&>svg]:size-4 group-data-[size=lg]/avatar:[&>svg]:size-5 group-data-[size=sm]/avatar:[&>svg]:size-3",
    avatarToneClassNames[avatar.tone]
  )

  return (
    <Avatar
      key={getAgentAvatarRenderKey(
        avatar.kind === "image"
          ? { kind: "image", initials: avatar.initials, src: avatar.src, tone: avatar.tone }
          : avatar.kind === "icon"
            ? { kind: "icon", iconName: "icon", initials: avatar.initials, tone: avatar.tone }
            : { kind: "initials", initials: avatar.initials, tone: avatar.tone }
      )}
      aria-label={agent.name}
      className={className}
      size={size}
      {...props}
    >
      {avatar.kind === "image" ? (
        <AvatarImage alt={agent.name} src={avatar.src} />
      ) : null}
      <AvatarFallback className={fallbackClassName}>
        {avatar.kind === "icon" ? (
          <avatar.icon aria-hidden="true" />
        ) : (
          avatar.initials
        )}
      </AvatarFallback>
    </Avatar>
  )
}
