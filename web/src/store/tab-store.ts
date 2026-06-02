import { create } from "zustand"
import type { LucideIcon } from "lucide-react"
import {
  FileSearchIcon,
  FolderOpenIcon,
  GlobeIcon,
  ListTodoIcon,
  RocketIcon,
  SquareTerminalIcon,
} from "lucide-react"

export type SingletonTabId = "conversation-status" | "review" | "files" | "deploy"
export type MultiTabId = "terminal" | "preview"
export type TabType = SingletonTabId | MultiTabId

export type PreviewTabPayload = {
  source: "manual" | "artifact" | "deploy"
  initialUrl?: string
}

export type TerminalTabPayload = {
  conversationId: string
  workspaceId: string
  workspaceLabel: string
  sessionId?: string
}

export type DiffReviewTabPayload = {
  source: "artifact" | "live"
  title?: string
  conversationId?: string
  artifactId?: string
  syntheticId?: string
  workspaceDiff?: Record<string, unknown>
  patchText?: string
}

export type TabPayload =
  | PreviewTabPayload
  | TerminalTabPayload
  | DiffReviewTabPayload

export type TabInstance = {
  uid: string
  type: TabType
  title: string
  icon: LucideIcon
  payload?: TabPayload
}

export type WorkspaceFocusRequest = {
  id: string
  tabType: SingletonTabId
  conversationId?: string
  reason: "manual" | "plan"
  reasonKey: string
}

export const tabMeta: Record<TabType, { icon: LucideIcon; label: string }> = {
  "conversation-status": { icon: ListTodoIcon, label: "会话状态" },
  review: { icon: FileSearchIcon, label: "代码审查" },
  files: { icon: FolderOpenIcon, label: "文件浏览" },
  deploy: { icon: RocketIcon, label: "部署预览" },
  terminal: { icon: SquareTerminalIcon, label: "终端" },
  preview: { icon: GlobeIcon, label: "浏览器" },
}

export const singletonTabIds: SingletonTabId[] = [
  "conversation-status",
  "review",
  "files",
  "deploy",
]
export const multiTabIds: MultiTabId[] = ["terminal", "preview"]

type TabStore = {
  tabs: TabInstance[]
  activeTabUid: string | null
  mountedTabUids: Set<string>
  tabCounters: Record<MultiTabId, number>
  isWorkspaceCollapsed: boolean
  workspaceFocusRequest: WorkspaceFocusRequest | null
  workspaceFocusRequestSeq: number

  openTab: (type: TabType, title?: string, payload?: TabPayload) => string
  closeTab: (uid: string) => void
  activateTab: (uid: string) => void
  closeAllTabs: () => void
  updateTabPayload: (uid: string, payload: TabPayload) => void
  isSingletonOpen: (type: SingletonTabId) => boolean
  setWorkspaceCollapsed: (collapsed: boolean) => void
  requestWorkspaceFocus: (
    request: Omit<WorkspaceFocusRequest, "id">
  ) => WorkspaceFocusRequest
  consumeWorkspaceFocusRequest: (id: string) => void
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabUid: null,
  mountedTabUids: new Set(),
  tabCounters: { terminal: 0, preview: 0 },
  isWorkspaceCollapsed: true,
  workspaceFocusRequest: null,
  workspaceFocusRequestSeq: 0,

  openTab: (type, title, payload) => {
    const state = get()
    const meta = tabMeta[type]

    // Singleton: already open → just activate
    if (singletonTabIds.includes(type as SingletonTabId)) {
      const existing = state.tabs.find((t) => t.type === type)
      if (existing) {
        set((s) => ({
          tabs: s.tabs.map((tab) =>
            tab.uid === existing.uid
              ? {
                  ...tab,
                  ...(title ? { title } : {}),
                  ...(payload ? { payload } : {}),
                }
              : tab
          ),
          activeTabUid: existing.uid,
        }))
        return existing.uid
      }

      const uid = type
      const tab: TabInstance = {
        uid,
        type,
        title: title ?? meta.label,
        icon: meta.icon,
        payload,
      }
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabUid: uid,
        mountedTabUids: new Set([...s.mountedTabUids, uid]),
      }))
      return uid
    }

    // Multi-instance
    const multiType = type as MultiTabId
    const counter = state.tabCounters[multiType]

    // Terminal: derive default title from workspace label
    const derivedTitle =
      title ??
      (type === "terminal" && payload && "workspaceLabel" in payload
        ? `${meta.label} - ${(payload as unknown as TerminalTabPayload).workspaceLabel}`
        : `${meta.label}${counter + 1}`)

    const uid = `${type}-${counter + 1}`
    const tab: TabInstance = {
      uid,
      type,
      title: derivedTitle,
      icon: meta.icon,
      payload,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabUid: uid,
      mountedTabUids: new Set([...s.mountedTabUids, uid]),
      tabCounters: { ...s.tabCounters, [multiType]: counter + 1 },
    }))
    return uid
  },

  closeTab: (uid) => {
    const state = get()
    const idx = state.tabs.findIndex((t) => t.uid === uid)
    if (idx === -1) return

    const newTabs = state.tabs.filter((t) => t.uid !== uid)
    const newMounted = new Set(state.mountedTabUids)
    newMounted.delete(uid)

    let newActive = state.activeTabUid
    if (state.activeTabUid === uid) {
      if (newTabs.length === 0) {
        newActive = null
      } else {
        const nextIdx = Math.min(idx, newTabs.length - 1)
        newActive = newTabs[nextIdx].uid
      }
    }

    // Ensure active is in mounted
    if (newActive) {
      newMounted.add(newActive)
    }

    set({
      tabs: newTabs,
      activeTabUid: newActive,
      mountedTabUids: newMounted,
    })
  },

  activateTab: (uid) => {
    set((s) => ({
      activeTabUid: uid,
      mountedTabUids: new Set([...s.mountedTabUids, uid]),
    }))
  },

  closeAllTabs: () => {
    set({
      tabs: [],
      activeTabUid: null,
      mountedTabUids: new Set(),
    })
  },

  updateTabPayload: (uid, payload) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.uid === uid ? { ...tab, payload } : tab
      ),
    }))
  },

  isSingletonOpen: (type) => {
    return get().tabs.some((t) => t.type === type)
  },

  setWorkspaceCollapsed: (collapsed) => {
    set({ isWorkspaceCollapsed: collapsed })
  },

  requestWorkspaceFocus: (request) => {
    const nextSeq = get().workspaceFocusRequestSeq + 1
    const focusRequest: WorkspaceFocusRequest = {
      ...request,
      id: `workspace-focus-${nextSeq}`,
    }
    set({
      workspaceFocusRequest: focusRequest,
      workspaceFocusRequestSeq: nextSeq,
    })
    return focusRequest
  },

  consumeWorkspaceFocusRequest: (id) => {
    set((state) =>
      state.workspaceFocusRequest?.id === id
        ? { workspaceFocusRequest: null }
        : state
    )
  },
}))
