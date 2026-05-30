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

// ── Workspace Browser Types ──

export type WorkspaceTreeEntry = {
  name: string
  path: string
  kind: "file" | "dir"
  hasChildren?: boolean
}

export type WorkspaceTreeResponse = {
  workspace: {
    workspaceId: string
    backendType: "local"
    rootLabel: string
  }
  parentPath: string
  entries: WorkspaceTreeEntry[]
}

export type WorkspaceFilePreviewResponse =
  | {
      kind: "text"
      path: string
      name: string
      mimeType: string
      size: number
      content: string
    }
  | {
      kind: "image"
      path: string
      name: string
      mimeType: string
      size: number
      base64: string
    }
  | {
      kind: "unsupported"
      path: string
      name: string
      mimeType: string
      size: number
      message: string
    }

export type WorkspaceSearchResponse = {
  entries: WorkspaceTreeEntry[]
}
