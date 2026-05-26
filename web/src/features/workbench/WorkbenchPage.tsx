import { useState, useMemo, useCallback } from "react";
import { Toaster } from "sonner";

import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn } from "@/lib/utils";

import { conversations } from "./mock-data";
import { WorkbenchContentLayout } from "./components/WorkbenchContentLayout";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { SettingsDialog } from "../settings/SettingsDialog";
import { AgentsDialog } from "../agents/AgentsDialog";

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

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleOpenAgents = useCallback(() => {
    setAgentsOpen(true);
  }, []);

  return (
    <>
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
      </main>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <AgentsDialog open={agentsOpen} onOpenChange={setAgentsOpen} />
      <Toaster position="top-center" richColors />
    </>
  );
}
