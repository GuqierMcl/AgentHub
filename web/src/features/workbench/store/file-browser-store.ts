import { create } from "zustand"

import type { WorkspaceTreeEntry } from "../right-workbench/types"

type FileBrowserState = {
  selectedPath: string | null
  openFolders: Set<string>
  treeNodes: Record<string, WorkspaceTreeEntry[]>
  query: string
}

type FileBrowserStore = {
  states: Record<string, FileBrowserState>
  getState: (conversationId: string) => FileBrowserState
  setSelectedPath: (conversationId: string, path: string | null) => void
  toggleFolder: (conversationId: string, path: string) => void
  loadTreeNodes: (conversationId: string, path: string, entries: WorkspaceTreeEntry[]) => void
  setQuery: (conversationId: string, query: string) => void
}

function createEmptyState(): FileBrowserState {
  return {
    selectedPath: null,
    openFolders: new Set(),
    treeNodes: {},
    query: "",
  }
}

function getOrCreateState(states: Record<string, FileBrowserState>, conversationId: string): FileBrowserState {
  return states[conversationId] ?? createEmptyState()
}

export const useFileBrowserStore = create<FileBrowserStore>((set, get) => ({
  states: {},

  getState: (conversationId) => {
    return getOrCreateState(get().states, conversationId)
  },

  setSelectedPath: (conversationId, path) => {
    set((s) => ({
      states: {
        ...s.states,
        [conversationId]: {
          ...getOrCreateState(s.states, conversationId),
          selectedPath: path,
        },
      },
    }))
  },

  toggleFolder: (conversationId, path) => {
    set((s) => {
      const current = getOrCreateState(s.states, conversationId)
      const next = new Set(current.openFolders)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return {
        states: {
          ...s.states,
          [conversationId]: {
            ...current,
            openFolders: next,
          },
        },
      }
    })
  },

  loadTreeNodes: (conversationId, path, entries) => {
    set((s) => {
      const current = getOrCreateState(s.states, conversationId)
      return {
        states: {
          ...s.states,
          [conversationId]: {
            ...current,
            treeNodes: {
              ...current.treeNodes,
              [path]: entries,
            },
          },
        },
      }
    })
  },

  setQuery: (conversationId, query) => {
    set((s) => ({
      states: {
        ...s.states,
        [conversationId]: {
          ...getOrCreateState(s.states, conversationId),
          query,
        },
      },
    }))
  },
}))
