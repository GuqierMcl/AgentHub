export function derivePreviewTabFallbackTitle(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return "浏览器"

  try {
    return new URL(trimmed).hostname || trimmed
  } catch {
    return trimmed
  }
}

export function resolvePreviewTabTitle(
  url: string,
  documentTitle: string | null | undefined
): string {
  const normalizedTitle = documentTitle?.trim()
  if (normalizedTitle) return normalizedTitle
  return derivePreviewTabFallbackTitle(url)
}
