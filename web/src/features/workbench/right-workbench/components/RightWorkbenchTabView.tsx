import { Activity } from "react"

import { cn } from "@/lib/utils"

import type { DiffReviewTabPayload, TabInstance } from "@/store/tab-store"
import type { RuntimeRunStatus } from "@/features/workbench/api/runtime-runs"
import type { RunConnectionStatus } from "@/features/workbench/store/workbench-store"
import type { Conversation } from "@/features/workbench/types"

import { BrowserPanel } from "./BrowserPanel"
import { CodeReviewPanel } from "./CodeReviewPanel"
import { ConversationStatusPanel } from "./ConversationStatusPanel"
import { DeployPreviewPanel } from "./DeployPreviewPanel"
import { FileBrowserPanel } from "./FileBrowserPanel"
import { TerminalPanel } from "./TerminalPanel"

type RightWorkbenchTabViewProps = {
  tabs: readonly TabInstance[]
  activeTabUid: string | null
  mountedTabUids: ReadonlySet<string>
  conversation: Conversation | null
  connectionStatus: RunConnectionStatus
  runStatus: RuntimeRunStatus | "idle" | "submitted"
}

function renderPanel(
  tab: TabInstance,
  {
    connectionStatus,
    conversation,
    runStatus,
  }: Pick<
    RightWorkbenchTabViewProps,
    "connectionStatus" | "conversation" | "runStatus"
  >
) {
  switch (tab.type) {
    case "conversation-status":
      return (
        <ConversationStatusPanel
          connectionStatus={connectionStatus}
          conversation={conversation}
          runStatus={runStatus}
        />
      )
    case "review":
      return (
        <CodeReviewPanel
          payload={
            isDiffReviewTabPayload(tab.payload)
              ? tab.payload
              : undefined
          }
        />
      )
    case "files":
      return <FileBrowserPanel conversation={conversation} />
    case "deploy":
      return <DeployPreviewPanel />
    case "terminal":
      return (
        <TerminalPanel
          uid={tab.uid}
          payload={
            tab.payload && "workspaceId" in tab.payload
              ? tab.payload
              : undefined
          }
        />
      )
    case "preview":
      return (
        <BrowserPanel
          initialUrl={
            tab.payload && "initialUrl" in tab.payload
              ? tab.payload.initialUrl
              : undefined
          }
        />
      )
    default:
      return null
  }
}

function isDiffReviewTabPayload(
  payload: TabInstance["payload"]
): payload is DiffReviewTabPayload {
  if (!payload || !("source" in payload)) return false
  if (payload.source === "live") return true
  return payload.source === "artifact" &&
    ("artifactId" in payload || "workspaceDiff" in payload || "syntheticId" in payload)
}

export function RightWorkbenchTabView({
  tabs,
  activeTabUid,
  mountedTabUids,
  conversation,
  connectionStatus,
  runStatus,
}: RightWorkbenchTabViewProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {tabs.map((tab) => {
        const isActive = tab.uid === activeTabUid
        const shouldMount = mountedTabUids.has(tab.uid) || isActive

        if (!shouldMount) {
          return null
        }

        return (
          <Activity
            key={tab.uid}
            mode={isActive ? "visible" : "hidden"}
            name={`right-workbench-${tab.uid}`}
          >
            <div
              aria-hidden={!isActive}
              className={cn(
                "absolute inset-0 min-h-0 min-w-0 overflow-hidden",
                isActive ? "flex" : "hidden"
              )}
              data-tab-uid={tab.uid}
            >
              {renderPanel(tab, { connectionStatus, conversation, runStatus })}
            </div>
          </Activity>
        )
      })}
    </div>
  )
}
