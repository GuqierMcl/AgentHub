import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

export type RightWorkbenchTabId = "review" | "files" | "deploy"

export type WorkbenchTabDefinition = {
  id: RightWorkbenchTabId
  label: string
  description: string
  icon: LucideIcon
  badge?: string
}

export type WorkbenchTabPanel = {
  id: RightWorkbenchTabId
  content: ReactNode
}

export type ReviewFile = {
  path: string
  status: "modified" | "added" | "review"
  additions: number
  deletions: number
  risk: "low" | "medium" | "high"
  summary: string
}

export type ReviewIssue = {
  id: string
  severity: "P0" | "P1" | "P2"
  title: string
  location: string
  description: string
}

export type WorkspaceFile = {
  path: string
  name: string
  group: string
  status: "modified" | "new" | "clean"
  language: string
  preview: string
}

export type DeploymentEvent = {
  id: string
  title: string
  detail: string
  state: "done" | "running" | "waiting"
}
