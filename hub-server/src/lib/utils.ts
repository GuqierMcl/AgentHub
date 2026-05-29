export function safeJsonParse<T = unknown>(value: string | undefined | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}