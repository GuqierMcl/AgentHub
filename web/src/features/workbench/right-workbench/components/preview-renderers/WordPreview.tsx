import { useCallback, useEffect, useRef, useState } from "react"
import { renderAsync } from "docx-preview"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"

type WordPreviewProps = {
  url: string
  name: string
}

export function WordPreview({ url, name }: WordPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scaledFrameRef = useRef<HTMLDivElement>(null)
  const scrollAreaHostRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resizeTick, setResizeTick] = useState(0)

  const scrollAreaHostRefCallback = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    scrollAreaHostRef.current = node
    viewportRef.current =
      node?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ??
      null

    if (node && typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(() => {
        setResizeTick((current) => current + 1)
      })
      observerRef.current.observe(viewportRef.current ?? node)
    }
  }, [])

  const updateResponsiveScale = useCallback(() => {
    const host = viewportRef.current ?? scrollAreaHostRef.current
    const container = containerRef.current
    const scaledFrame = scaledFrameRef.current

    if (!host || !container || !scaledFrame) return

    const wrapper =
      (container.querySelector(".docx-preview-wrapper") as HTMLDivElement | null) ??
      (container.firstElementChild as HTMLDivElement | null)

    if (!wrapper) return

    const firstPage =
      (wrapper.querySelector("section.docx-preview") as HTMLElement | null) ??
      (wrapper.querySelector("section") as HTMLElement | null)

    const contentWidth = Math.ceil(
      firstPage?.offsetWidth ?? wrapper.scrollWidth ?? wrapper.offsetWidth
    )
    const contentHeight = Math.ceil(
      wrapper.scrollHeight ?? wrapper.offsetHeight
    )

    if (contentWidth <= 0 || contentHeight <= 0) return

    const availableWidth =
      host.clientWidth - 32

    const scale =
      availableWidth > 0
        ? Math.min(1, availableWidth / contentWidth)
        : 1

    container.style.width = `${contentWidth}px`
    container.style.height = `${contentHeight}px`
    container.style.transformOrigin = "top left"
    container.style.transform = `scale(${scale})`

    scaledFrame.style.width = `${Math.ceil(contentWidth * scale)}px`
    scaledFrame.style.height = `${Math.ceil(contentHeight * scale)}px`
  }, [])

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current

    setLoading(true)
    setError(null)

    async function loadDocx() {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error("无法加载文件")
        const blob = await res.blob()
        if (cancelled || !container) return
        container.innerHTML = ""
        await renderAsync(blob, container, undefined, {
          className: "docx-preview",
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreLastRenderedPageBreak: false,
          useBase64URL: false,
          renderChanges: false,
          renderComments: false,
          renderAltChunks: false,
        })
        if (!cancelled) {
          setLoading(false)
          window.requestAnimationFrame(() => {
            if (!cancelled) {
              updateResponsiveScale()
            }
          })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Word 预览加载失败")
          setLoading(false)
        }
      }
    }

    loadDocx()

    return () => {
      cancelled = true
      observerRef.current?.disconnect()
      if (container) {
        container.innerHTML = ""
      }
    }
  }, [url, name, updateResponsiveScale])

  useEffect(() => {
    if (loading || error) return
    updateResponsiveScale()
  }, [error, loading, resizeTick, updateResponsiveScale])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center border-border border-b px-3 py-1.5 text-xs text-muted-foreground">
        Word 预览
      </div>
      <div className="min-h-0 flex-1" ref={scrollAreaHostRefCallback}>
        <ScrollArea className="size-full">
          {loading && (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="min-h-0 flex-1 rounded" />
              <Skeleton className="h-5 w-96" />
              <Skeleton className="h-5 w-64" />
            </div>
          )}
          <div
            className="flex min-h-full justify-center p-4"
            style={{ display: loading ? "none" : undefined }}
          >
            <div className="relative shrink-0" ref={scaledFrameRef}>
              <div
                ref={containerRef}
                className="absolute left-0 top-0"
              />
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
