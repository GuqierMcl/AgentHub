import { toast } from "sonner"
import { useCallback, useEffect, useMemo, useRef } from "react"

import type { ConversationAgentProfile } from "@/features/workbench/types"

import { useInstructAgentSession } from "../hooks/use-instruct-agent-session"
import { InstructChatPanel } from "./InstructChatPanel"

type InstructAgentCreateChatProps = {
  onOpenManualCreate: () => Promise<void> | void
  onOpenAgent: (agentId: string) => Promise<void> | void
  onRefreshAgents: () => Promise<void> | void
}

const INSTRUCT_AGENT_PROFILE: ConversationAgentProfile = {
  id: "instruct-agent",
  name: "智能体创建助手",
  shortName: "创建",
  role: "primary",
  capabilities: ["Agent Authoring"],
  enabled: true,
}

export function InstructAgentCreateChat({
  onOpenManualCreate,
  onOpenAgent,
  onRefreshAgents,
}: InstructAgentCreateChatProps) {
  const session = useInstructAgentSession()
  const notifiedAgentIdRef = useRef<string | null>(null)
  const agentProfiles = useMemo(() => [INSTRUCT_AGENT_PROFILE], [])

  useEffect(() => {
    if (!session.savedAgent) {
      return
    }

    if (notifiedAgentIdRef.current === session.savedAgent.id) {
      return
    }

    notifiedAgentIdRef.current = session.savedAgent.id
    toast.success("智能体已创建")
    void onRefreshAgents()
  }, [onRefreshAgents, session.savedAgent])

  const handleOpenManualCreate = useCallback(async () => {
    if (session.activeRunId) {
      try {
        await session.cancel()
      } catch {
        // Best effort cancel; switching to manual create should still be allowed.
      }
    }
    await onOpenManualCreate()
  }, [onOpenManualCreate, session])

  const handleOpenAgent = useCallback(async (agentId: string) => {
    await onRefreshAgents()
    await onOpenAgent(agentId)
  }, [onOpenAgent, onRefreshAgents])

  const handleContinueCreate = useCallback(async () => {
    notifiedAgentIdRef.current = null
    await session.reset()
  }, [session])

  return (
    <InstructChatPanel
      activeRunId={session.activeRunId}
      agentProfiles={agentProfiles}
      connectionStatus={session.connectionStatus}
      draft={session.draft}
      onAnswerQuestion={session.answerQuestion}
      onCancelRun={session.cancel}
      onContinueCreate={handleContinueCreate}
      onDraftChange={session.setDraft}
      onOpenManualCreate={handleOpenManualCreate}
      onOpenAgent={handleOpenAgent}
      onSubmit={session.submit}
      runStatus={session.runStatus}
      savedAgent={session.savedAgent}
      templatePrompt={session.templatePrompt}
      timelineItems={session.timelineItems}
    />
  )
}
