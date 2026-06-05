import type { ChatStatus } from "ai";
import { BotIcon, Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfiniteLinearProgress } from "@/components/ui/infinite-linear-progress";
import type {
  ConversationAgentProfile,
  WorkbenchTimelineItem,
  WorkbenchTimelineQuestionItem,
} from "@/features/workbench/types";

import { InstructAgentSavedCard } from "./InstructAgentSavedCard";
import { InstructAgentTemplatePrompt } from "./InstructAgentTemplatePrompt";
import { InstructChatComposer } from "./InstructChatComposer";
import { InstructQuestionAnswerComposer } from "./InstructQuestionAnswerComposer";
import { InstructTimelineList } from "./InstructTimelineList";
import type {
  InstructConnectionStatus,
  InstructQuestionAnswerBody,
  InstructRunStatus,
  InstructSavedAgent,
} from "../types";

type InstructChatPanelProps = {
  agentProfiles: ConversationAgentProfile[];
  activeRunId: string | null;
  connectionStatus: InstructConnectionStatus;
  draft: string;
  runStatus: InstructRunStatus | "idle" | "submitted";
  savedAgent: InstructSavedAgent | null;
  templatePrompt: string;
  timelineItems: WorkbenchTimelineItem[];
  onAnswerQuestion: (
    runId: string,
    requestId: string,
    body: InstructQuestionAnswerBody,
  ) => Promise<void>;
  onOpenManualCreate: () => Promise<void> | void;
  onCancelRun: (options?: { fallbackToChat?: boolean }) => Promise<void> | void;
  onContinueCreate: () => Promise<void> | void;
  onDraftChange: (draft: string) => void;
  onOpenAgent: (agentId: string) => Promise<void> | void;
  onSubmit: (content: string) => Promise<void> | void;
};

export function InstructChatPanel({
  agentProfiles,
  activeRunId,
  connectionStatus,
  draft,
  onAnswerQuestion,
  onOpenManualCreate,
  onCancelRun,
  onContinueCreate,
  onDraftChange,
  onOpenAgent,
  onSubmit,
  runStatus,
  savedAgent,
  templatePrompt,
  timelineItems,
}: InstructChatPanelProps) {
  const pendingQuestions = useMemo(
    () => getPendingQuestionItems(timelineItems),
    [timelineItems],
  );
  const hasPendingQuestions = pendingQuestions.length > 0;
  const showRunProgress = shouldShowRunProgress(runStatus);
  const submitStatus = getSubmitStatus(runStatus, connectionStatus);
  const composerDisabled =
    runStatus === "submitted" ||
    runStatus === "queued" ||
    runStatus === "running" ||
    runStatus === "waiting_input";

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <header className="relative flex min-h-20 shrink-0 items-center justify-between gap-4 border-border border-b bg-background px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BotIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-semibold">
                智能体创建助手
              </h2>
              <Badge variant="secondary">{getStatusLabel(runStatus)}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              通过 instruct-agent 收集创建信息并保存到 AgentStore
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 mr-10">
          {savedAgent ? (
            <Button
              onClick={() => void onContinueCreate()}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCwIcon data-icon="inline-start" />
              继续创建
            </Button>
          ) : null}
          <Button
            onClick={() => void onOpenManualCreate()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon data-icon="inline-start" />
            手动新增
          </Button>
        </div>
        {showRunProgress ? (
          <InfiniteLinearProgress
            aria-label="正在创建智能体"
            className="absolute inset-x-0 bottom-0 h-0.5 rounded-none bg-muted/60"
          />
        ) : null}
      </header>

      {timelineItems.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <InstructAgentTemplatePrompt templatePrompt={templatePrompt} />
          </div>
        </div>
      ) : (
        <InstructTimelineList
          agentProfiles={agentProfiles}
          timelineItems={timelineItems}
        />
      )}

      {savedAgent ? (
        <div className="border-border border-t px-4 py-4">
          <div className="mx-auto max-w-3xl">
            <InstructAgentSavedCard
              agent={savedAgent}
              onContinue={() => void onContinueCreate()}
              onOpenAgent={(agentId) => void onOpenAgent(agentId)}
            />
          </div>
        </div>
      ) : null}

      {hasPendingQuestions ? (
        <InstructQuestionAnswerComposer
          agentProfiles={agentProfiles}
          onAnswerQuestion={onAnswerQuestion}
          onSkipRun={(runId) => {
            if (activeRunId && runId === activeRunId) {
              return onCancelRun({ fallbackToChat: true });
            }
            return Promise.resolve();
          }}
          requests={pendingQuestions}
        />
      ) : (
        <InstructChatComposer
          canCancelRun={Boolean(activeRunId)}
          disabled={composerDisabled}
          onCancelRun={onCancelRun}
          onSubmit={onSubmit}
          onValueChange={onDraftChange}
          status={submitStatus}
          value={draft}
        />
      )}

      {connectionStatus === "connecting" ? (
        <div className="pointer-events-none absolute right-6 bottom-24 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm">
          <Loader2Icon className="size-3.5 animate-spin" />
          正在连接运行流
        </div>
      ) : null}
    </section>
  );
}

function shouldShowRunProgress(
  runStatus: InstructRunStatus | "idle" | "submitted",
): boolean {
  return (
    runStatus === "submitted" ||
    runStatus === "queued" ||
    runStatus === "running" ||
    runStatus === "waiting_input"
  );
}

function getSubmitStatus(
  runStatus: InstructRunStatus | "idle" | "submitted",
  connectionStatus: InstructConnectionStatus,
): ChatStatus {
  if (runStatus === "submitted" || runStatus === "queued") return "submitted";
  if (runStatus === "running" || runStatus === "waiting_input")
    return "streaming";
  if (runStatus === "failed" || connectionStatus === "error") return "error";
  return "ready";
}

function getPendingQuestionItems(
  items: WorkbenchTimelineItem[],
): WorkbenchTimelineQuestionItem[] {
  const pending: WorkbenchTimelineQuestionItem[] = [];
  for (const item of items) {
    if (item.kind === "question" && item.status === "pending") {
      pending.push(item);
    }
    if (item.kind === "chat_message") {
      pending.push(
        ...(item.questionItems ?? []).filter(
          (question) => question.status === "pending",
        ),
      );
    }
    if (item.kind === "task") {
      pending.push(
        ...(item.questionItems ?? []).filter(
          (question) => question.status === "pending",
        ),
      );
    }
  }
  return pending;
}

function getStatusLabel(
  status: InstructRunStatus | "idle" | "submitted",
): string {
  switch (status) {
    case "submitted":
      return "已提交";
    case "queued":
      return "排队中";
    case "running":
      return "进行中";
    case "waiting_input":
      return "待补充";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "未开始";
  }
}
