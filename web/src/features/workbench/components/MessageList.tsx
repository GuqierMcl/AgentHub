import { Button } from "@/components/ui/button"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowDownIcon } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from "react"

import type {
  ConversationAgentProfile,
  WorkbenchTimelineItem,
} from "../types"
import { buildRegeneratedBranchTimelineItems } from "../utils/regenerated-branch"
import { getNextHasUserScrolledUp } from "../utils/scroll-follow-state"
import { getTimelineMessagePinTargetId } from "../utils/message-pin-target"
import { TimelineItem } from "./MessageItem"
import type { MessageReplySnapshot } from "../api/messages"

type TimelineListProps = {
  conversationId?: string
  timelineItems: WorkbenchTimelineItem[]
  agentProfiles: ConversationAgentProfile[]
  pinnedMessageIds?: Set<string>
  onPinToggle?: (messageId: string) => void
  onReply?: (target: MessageReplySnapshot) => void
  onRegenerate?: (messageId: string) => void
  hasOlderHistory?: boolean
  isLoadingOlderHistory?: boolean
  olderHistoryError?: string | null
  historyPrependVersion?: number
  onLoadOlderHistory?: () => Promise<void> | void
}

type AutoLoadOlderHistoryArgs = {
  hasOlderHistory: boolean
  isLoadingOlderHistory: boolean
  olderHistoryError: string | null
  hasUserScrolledUp: boolean
  isScrollable: boolean
  hasLoadHandler: boolean
}

function shouldAutoLoadOlderHistory({
  hasOlderHistory,
  isLoadingOlderHistory,
  olderHistoryError,
  hasUserScrolledUp,
  isScrollable,
  hasLoadHandler,
}: AutoLoadOlderHistoryArgs): boolean {
  return Boolean(
    hasOlderHistory &&
      !isLoadingOlderHistory &&
      !olderHistoryError &&
      hasUserScrolledUp &&
      isScrollable &&
      hasLoadHandler
  )
}

const SCROLL_BOTTOM_THRESHOLD = 80
const ITEM_ESTIMATE_SIZE = 250

export const TimelineList = memo(function TimelineList({
  conversationId,
  agentProfiles,
  timelineItems,
  pinnedMessageIds,
  onPinToggle,
  onReply,
  onRegenerate,
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  olderHistoryError = null,
  historyPrependVersion = 0,
  onLoadOlderHistory,
}: TimelineListProps) {
  const displayItems = useMemo(
    () => buildRegeneratedBranchTimelineItems(timelineItems),
    [timelineItems]
  )

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRestoreRef = useRef<{
    scrollTop: number
    scrollHeight: number
  } | null>(null)
  const hasUserScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const shouldAutoScrollRef = useRef(false)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ITEM_ESTIMATE_SIZE,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 5,
    onChange: () => {
      if (!hasUserScrolledUpRef.current && !pendingScrollRestoreRef.current) {
        shouldAutoScrollRef.current = true
      }
    },
  })

  useLayoutEffect(() => {
    if (shouldAutoScrollRef.current && scrollContainerRef.current) {
      shouldAutoScrollRef.current = false
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  })

  const handleScroll = useCallback(() => {
    const root = scrollContainerRef.current
    if (!root) return

    const { scrollTop, scrollHeight, clientHeight } = root
    const atBottom = scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD
    setIsAtBottom(atBottom)

    hasUserScrolledUpRef.current = getNextHasUserScrolledUp({
      atBottom,
      hasUserScrolledUp: hasUserScrolledUpRef.current,
      lastScrollTop: lastScrollTopRef.current,
      scrollTop,
    })
    lastScrollTopRef.current = scrollTop
  }, [])

  useEffect(() => {
    hasUserScrolledUpRef.current = false
    lastScrollTopRef.current = 0
  }, [conversationId])

  const triggerLoadOlderHistory = useCallback(
    async (source: "auto" | "manual" = "auto") => {
      const loadOlderHistory = onLoadOlderHistory
      const scrollElement = scrollContainerRef.current
      const isScrollable = Boolean(
        scrollElement && scrollElement.scrollHeight > scrollElement.clientHeight
      )

      if (
        source === "auto" &&
        !shouldAutoLoadOlderHistory({
          hasOlderHistory,
          isLoadingOlderHistory,
          olderHistoryError,
          hasUserScrolledUp: hasUserScrolledUpRef.current,
          isScrollable,
          hasLoadHandler: Boolean(loadOlderHistory),
        })
      ) {
        return
      }

      if (source === "manual" && (!hasOlderHistory || isLoadingOlderHistory || !loadOlderHistory)) {
        return
      }

      if (scrollElement) {
        pendingScrollRestoreRef.current = {
          scrollTop: scrollElement.scrollTop,
          scrollHeight: scrollElement.scrollHeight,
        }
      }

      if (!loadOlderHistory) return
      await loadOlderHistory()
    },
    [hasOlderHistory, isLoadingOlderHistory, olderHistoryError, onLoadOlderHistory]
  )

  useEffect(() => {
    const root = scrollContainerRef.current
    const target = topSentinelRef.current
    if (!root || !target || !hasOlderHistory || olderHistoryError) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void triggerLoadOlderHistory()
        }
      },
      { root, threshold: 0 }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasOlderHistory, olderHistoryError, triggerLoadOlderHistory, historyPrependVersion])

  useLayoutEffect(() => {
    const pending = pendingScrollRestoreRef.current
    const scrollElement = scrollContainerRef.current
    if (!pending || !scrollElement) return

    const nextScrollTop =
      pending.scrollTop + (scrollElement.scrollHeight - pending.scrollHeight)
    scrollElement.scrollTop = Math.max(0, nextScrollTop)
    pendingScrollRestoreRef.current = null
  }, [historyPrependVersion])

  const scrollToBottom = useCallback(() => {
    hasUserScrolledUpRef.current = false
    setIsAtBottom(true)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto scrollbar-shadcn"
        role="log"
        onScroll={handleScroll}
      >
        <div className="flex flex-col gap-5 p-5">
          <div ref={topSentinelRef} className="h-px w-full shrink-0" />
          {isLoadingOlderHistory ? (
            <div className="flex justify-center text-muted-foreground text-sm">
              加载更早消息中...
            </div>
          ) : null}
          {olderHistoryError ? (
            <div className="flex items-center justify-center gap-3 text-muted-foreground text-sm">
              <span>{olderHistoryError}</span>
              {onLoadOlderHistory ? (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void triggerLoadOlderHistory("manual")
                  }}
                >
                  重试
                </Button>
              ) : null}
            </div>
          ) : null}
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualItem) => {
              const item = displayItems[virtualItem.index]
              const pinTargetMessageId =
                item.kind === "chat_message"
                  ? getTimelineMessagePinTargetId(item)
                  : null
              const isPinned = pinTargetMessageId
                ? pinnedMessageIds?.has(pinTargetMessageId) ?? false
                : false

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <TimelineItem
                    agentProfiles={agentProfiles}
                    item={item}
                    key={item.id}
                    isPinned={isPinned}
                    pinTargetMessageId={pinTargetMessageId}
                    onPinToggle={onPinToggle}
                    onReply={onReply}
                    onRegenerate={onRegenerate}
                    pinnedMessageIds={pinnedMessageIds}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {!isAtBottom ? (
        <Button
          className="absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted"
          onClick={scrollToBottom}
          size="icon"
          type="button"
          variant="outline"
        >
          <ArrowDownIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  )
})
