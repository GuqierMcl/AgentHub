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
