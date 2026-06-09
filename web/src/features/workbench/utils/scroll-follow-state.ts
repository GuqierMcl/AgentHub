type ScrollFollowStateArgs = {
  atBottom: boolean
  hasUserScrolledUp: boolean
  lastScrollTop: number
  scrollTop: number
}

type AutoScrollAfterContentChangeArgs = {
  hasUserScrolledUp: boolean
  hasPendingScrollRestore: boolean
}

type VirtualTimelineItemSpacingArgs = {
  index: number
  itemCount: number
}

const TIMELINE_ITEM_SPACING_PX = 16

export function getNextHasUserScrolledUp({
  atBottom,
  hasUserScrolledUp,
  lastScrollTop,
  scrollTop,
}: ScrollFollowStateArgs): boolean {
  if (atBottom) {
    return false
  }

  if (scrollTop < lastScrollTop) {
    return true
  }

  return hasUserScrolledUp
}

export function shouldAutoScrollAfterContentChange({
  hasUserScrolledUp,
  hasPendingScrollRestore,
}: AutoScrollAfterContentChangeArgs): boolean {
  return !hasUserScrolledUp && !hasPendingScrollRestore
}

export function getVirtualTimelineItemSpacingStyle({
  index,
  itemCount,
}: VirtualTimelineItemSpacingArgs): { paddingBottom: string } {
  return {
    paddingBottom:
      index < itemCount - 1 ? `${TIMELINE_ITEM_SPACING_PX}px` : "0px",
  }
}
