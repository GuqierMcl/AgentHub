type ScrollFollowStateArgs = {
  atBottom: boolean
  hasUserScrolledUp: boolean
  lastScrollTop: number
  scrollTop: number
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
