import type { LucideIcon } from "lucide-react"
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
} from "lucide-react"
import type { AgentAvatarTone } from "@/lib/avatar-resolve"

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
