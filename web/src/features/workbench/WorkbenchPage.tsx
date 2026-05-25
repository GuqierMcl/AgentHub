import { useState, useMemo } from "react";

import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn } from "@/lib/utils";

import { conversations } from "./mock-data";
import { WorkbenchContentLayout } from "./components/WorkbenchContentLayout";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { SettingsDialogWithToast } from "../settings/SettingsDialog";
import { AgentsDialog } from "../agents/AgentsDialog";
import { ToastProvider } from "../settings/components/toast";
import {
  defaultPreviewTarget,
  defaultSelectedFilePath,
} from "./right-workbench/mock-data";
import { type RightWorkbenchTabId } from "./right-workbench/RightWorkbench";
import type { Artifact, ArtifactKind } from "./types";

const artifactTabByType = {
  code: "files",
  deploy: "deploy",
  diff: "review",
  preview: "deploy",
} satisfies Record<ArtifactKind, RightWorkbenchTabId>;

export function WorkbenchPage() {
  const [activeConversationId, setActiveConversationId] = useState(
    conversations[0].id,
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ?? conversations[0],
    [activeConversationId],
  );

  useDocumentTitle({
    conversationTitle: activeConversation?.title,
  });

  const activateRightTab = useCallback((tabId: RightWorkbenchTabId) => {
    setActiveRightTab(tabId);
    setMountedRightTabs((current) => {
      if (current.has(tabId)) {
        return current;
      }

      const next = new Set(current);
      next.add(tabId);
      return next;
    });
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleOpenAgents = useCallback(() => {
    setAgentsOpen(true);
  }, []);

  const handleOpenArtifact = useCallback(
    (artifact: Artifact) => {
      setSelectedArtifact(artifact);
      activateRightTab(artifactTabByType[artifact.type]);

      if (artifact.type === "code") {
        setSelectedFilePath(
          "src/features/workbench/right-workbench/RightWorkbench.tsx",
        );
      }

      if (artifact.type === "diff") {
        setSelectedFilePath("src/features/workbench/WorkbenchPage.tsx");
      }

      if (artifact.type === "deploy" || artifact.type === "preview") {
        setPreviewTarget(artifact.title);
      }
    },
    [activateRightTab],
  );

  return (
    <main
      className={cn(
        "grid h-svh min-h-0 overflow-hidden bg-muted text-foreground",
        isSidebarCollapsed
          ? "grid-cols-[4.25rem_minmax(0,1fr)]"
          : "grid-cols-[20rem_minmax(0,1fr)]",
      )}
    >
      <ConversationSidebar
        activeConversationId={activeConversation.id}
        collapsed={isSidebarCollapsed}
        conversations={conversations}
        onSelectConversation={setActiveConversationId}
        onOpenSettings={handleOpenSettings}
        onOpenAgents={handleOpenAgents}
        onToggleCollapsed={() =>
          setIsSidebarCollapsed((collapsed) => !collapsed)
        }
      />
      <WorkbenchContentLayout activeConversation={activeConversation} />
      <SettingsDialogWithToast
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <ToastProvider>
        <AgentsDialog open={agentsOpen} onOpenChange={setAgentsOpen} />
      </ToastProvider>
    </main>
  );
}
