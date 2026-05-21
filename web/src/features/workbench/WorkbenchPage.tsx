import { useCallback, useMemo, useState } from "react"
import { BotIcon, PinIcon } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { useDocumentTitle } from "@/hooks/useDocumentTitle"
import { cn } from "@/lib/utils"

import { conversations, getAgentById } from "./mock-data"
import { ChatComposer } from "./components/ChatComposer"
import { ChatHeader } from "./components/ChatHeader"
import { ConversationSidebar } from "./components/ConversationSidebar"
import { MessageList } from "./components/MessageList"
import {
  defaultPreviewTarget,
  defaultSelectedFilePath,
} from "./right-workbench/mock-data"
import {
  RightWorkbench,
  type RightWorkbenchTabId,
} from "./right-workbench/RightWorkbench"
import type { Artifact, ArtifactKind } from "./types"

const artifactTabByType = {
  code: "files",
  deploy: "deploy",
  diff: "review",
  preview: "deploy",
} satisfies Record<ArtifactKind, RightWorkbenchTabId>

export function WorkbenchPage() {
  const [activeConversationId, setActiveConversationId] = useState(
    conversations[0].id
  )
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [activeRightTab, setActiveRightTab] =
    useState<RightWorkbenchTabId>("review")
  const [mountedRightTabs, setMountedRightTabs] = useState<
    Set<RightWorkbenchTabId>
  >(() => new Set(["review"]))
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null
  )
  const [selectedFilePath, setSelectedFilePath] = useState(
    defaultSelectedFilePath
  )
  const [previewTarget, setPreviewTarget] = useState(defaultPreviewTarget)
  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId
      ) ?? conversations[0],
    [activeConversationId]
  )
  const primaryAgent = getAgentById(activeConversation.agentIds[0])

  useDocumentTitle({
    conversationTitle: activeConversation?.title,
  })

  const activateRightTab = useCallback((tabId: RightWorkbenchTabId) => {
    setActiveRightTab(tabId)
    setMountedRightTabs((current) => {
      if (current.has(tabId)) {
        return current
      }

      const next = new Set(current)
      next.add(tabId)
      return next
    })
  }, [])

  const handleOpenArtifact = useCallback((artifact: Artifact) => {
    setSelectedArtifact(artifact)
    activateRightTab(artifactTabByType[artifact.type])

    if (artifact.type === "code") {
      setSelectedFilePath(
        "src/features/workbench/right-workbench/RightWorkbench.tsx"
      )
    }

    if (artifact.type === "diff") {
      setSelectedFilePath("src/features/workbench/WorkbenchPage.tsx")
    }

    if (artifact.type === "deploy" || artifact.type === "preview") {
      setPreviewTarget(artifact.title)
    }
  }, [activateRightTab])

  return (
    <main
      className={cn(
        "grid h-svh min-h-0 overflow-hidden bg-muted text-foreground max-md:grid-rows-[15rem_minmax(0,1fr)]",
        isSidebarCollapsed
          ? "md:grid-cols-[4.25rem_minmax(0,1fr)] lg:grid-cols-[4.25rem_minmax(0,1fr)_24rem]"
          : "md:grid-cols-[20rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)_24rem]"
      )}
    >
      <ConversationSidebar
        activeConversationId={activeConversation.id}
        collapsed={isSidebarCollapsed}
        conversations={conversations}
        onSelectConversation={setActiveConversationId}
        onToggleCollapsed={() =>
          setIsSidebarCollapsed((collapsed) => !collapsed)
        }
      />

      <section className="flex min-h-0 min-w-0 flex-col bg-background">
        <ChatHeader conversation={activeConversation} />
        <div className="flex shrink-0 items-center gap-2 border-border border-b bg-muted/40 px-5 py-2 text-muted-foreground text-xs">
          <PinIcon className="size-3.5" />
          <span className="truncate">
            Pinned: 当前为静态 Workbench 原型，不接入后端或 LLM Provider。
          </span>
          {primaryAgent ? (
            <>
              <Separator className="h-4" orientation="vertical" />
              <BotIcon className="size-3.5" />
              <span className="truncate">{primaryAgent.role}</span>
            </>
          ) : null}
        </div>
        <MessageList
          messages={activeConversation.messages}
          onOpenArtifact={handleOpenArtifact}
        />
        <ChatComposer />
      </section>

      <RightWorkbench
        activeTab={activeRightTab}
        mountedTabs={mountedRightTabs}
        onActiveTabChange={activateRightTab}
        onSelectedFilePathChange={setSelectedFilePath}
        previewTarget={previewTarget}
        selectedArtifact={selectedArtifact}
        selectedFilePath={selectedFilePath}
      />
    </main>
  )
}
