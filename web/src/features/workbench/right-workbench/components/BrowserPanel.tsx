import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RotateCwIcon } from "lucide-react"

import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  normalizeUrl,
  useWebPreview,
} from "@/components/ai-elements/web-preview"
import { useTabStore } from "@/store/tab-store"
import {
  derivePreviewTabFallbackTitle,
  resolvePreviewTabTitle,
} from "../utils/preview-tab-title"

type BrowserPanelStatus = "idle" | "loading" | "ready" | "error"
type PreviewViewportLayout = {
  frameHeight: number
  frameWidth: number
  renderedHeight: number
  renderedWidth: number
  scale: number
}

const DESKTOP_VIEWPORT_WIDTH = 1280
const RESOLVE_ENDPOINT = "/api/preview/resolve"

type BrowserPanelProps = {
  tabUid: string
  initialUrl?: string
}

function UrlSync({ url }: { url: string }) {
  const { setUrl } = useWebPreview()
  useEffect(() => {
    if (url) setUrl(url)
  }, [url, setUrl])
  return null
}

export function BrowserPanel({ tabUid, initialUrl }: BrowserPanelProps) {
  const normalizedInitialUrl = normalizeUrl(initialUrl ?? "")
  const [prevInitialUrl, setPrevInitialUrl] = useState(normalizedInitialUrl)
  const [navigatedUrl, setNavigatedUrl] = useState("")
  const [displayUrl, setDisplayUrl] = useState("")
  const [status, setStatus] = useState<BrowserPanelStatus>(
    initialUrl ? "loading" : "idle"
  )
  const [iframeKey, setIframeKey] = useState(0)
  const [viewportLayout, setViewportLayout] =
    useState<PreviewViewportLayout | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  if (normalizedInitialUrl !== prevInitialUrl) {
    setPrevInitialUrl(normalizedInitialUrl)
    setNavigatedUrl("")
    setDisplayUrl(normalizedInitialUrl)
    setStatus(normalizedInitialUrl ? "loading" : "idle")
    setIframeKey((k) => k + 1)
  }

  const navigateTo = useCallback(async (rawUrl: string) => {
    if (!rawUrl) return

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setStatus("loading")
    setDisplayUrl(rawUrl)
    useTabStore
      .getState()
      .updateTabTitle(tabUid, derivePreviewTabFallbackTitle(rawUrl))

    try {
      const res = await fetch(RESOLVE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: rawUrl }),
        signal: abortController.signal,
      })

      if (abortController.signal.aborted) return

      if (!res.ok) {
        setNavigatedUrl(rawUrl)
        return
      }

      const data = await res.json()
      if (abortController.signal.aborted) return

      const finalUrl: string = data.finalUrl
      setDisplayUrl(finalUrl)
      setNavigatedUrl(finalUrl)
      useTabStore
        .getState()
        .updateTabTitle(tabUid, derivePreviewTabFallbackTitle(finalUrl))
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setNavigatedUrl(rawUrl)
    }
  }, [tabUid])

  useEffect(() => {
    if (normalizedInitialUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      navigateTo(normalizedInitialUrl)
    }
  }, [normalizedInitialUrl, navigateTo])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const updateLayout = () => {
      const nextLayout = getPreviewViewportLayout(
        element.clientWidth,
        element.clientHeight
      )
      setViewportLayout(nextLayout)
    }

    updateLayout()

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateLayout)
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return
      const rawUrl = (event.target as HTMLInputElement).value
      if (!rawUrl.trim()) return
      navigateTo(normalizeUrl(rawUrl))
    },
    [navigateTo]
  )

  const handleRefresh = useCallback(() => {
    if (!navigatedUrl) return
    setIframeKey((k) => k + 1)
    setStatus("loading")
  }, [navigatedUrl])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "PREVIEW_NAVIGATE") return
      const url = event.data?.url
      if (typeof url !== "string" || !url) return
      const store = useTabStore.getState()
      store.openTab("preview", derivePreviewTabFallbackTitle(url), {
        source: "manual",
        initialUrl: url,
      })
      store.setWorkspaceCollapsed(false)
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const handleIframeLoad = useCallback(() => {
    setStatus("ready")
    const title = iframeRef.current?.contentDocument?.title
    useTabStore
      .getState()
      .updateTabTitle(tabUid, resolvePreviewTabTitle(navigatedUrl, title))
  }, [navigatedUrl, tabUid])

  const handleIframeError = useCallback(() => {
    setStatus("error")
  }, [])

  const iframeSrc = useMemo(() => {
    if (!navigatedUrl) return ""
    return `/api/preview/proxy?url=${encodeURIComponent(navigatedUrl)}`
  }, [navigatedUrl])

  const iframeStyle = useMemo(() => {
    if (!viewportLayout) return undefined
    return {
      height: `${viewportLayout.frameHeight}px`,
      transform: `scale(${viewportLayout.scale})`,
      transformOrigin: "top left",
      width: `${viewportLayout.frameWidth}px`,
    }
  }, [viewportLayout])

  const frameContainerStyle = useMemo(() => {
    if (!viewportLayout) return undefined
    return {
      height: `${viewportLayout.renderedHeight}px`,
      width: `${viewportLayout.renderedWidth}px`,
    }
  }, [viewportLayout])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <WebPreview className="flex min-h-0 min-w-0 flex-1 flex-col rounded-none border-none bg-transparent">
        <UrlSync url={displayUrl} />
        <WebPreviewNavigation>
          <WebPreviewNavigationButton
            disabled={!navigatedUrl}
            onClick={handleRefresh}
            tooltip="刷新"
          >
            <RotateCwIcon className="size-4" />
          </WebPreviewNavigationButton>
          <WebPreviewUrl
            placeholder="输入网址后按回车访问"
            onKeyDown={handleKeyDown}
          />
        </WebPreviewNavigation>

        <div
          className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-muted/20"
          ref={viewportRef}
        >
          {status === "idle" ? (
            <div className="flex h-full min-h-0 min-w-0 items-start justify-center overflow-hidden p-3">
              {viewportLayout ? (
                <div
                  className="relative shrink-0 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
                  style={frameContainerStyle}
                >
                  <div
                    className="flex flex-col bg-background"
                    style={iframeStyle}
                  >
                    <div className="flex min-h-0 flex-1 items-center justify-center bg-linear-to-b from-background to-muted/20 p-10">
                      <div className="w-full max-w-md text-center">
                        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-background shadow-xs">
                          <RotateCwIcon className="size-7 text-muted-foreground" />
                        </div>
                        <div className="font-medium text-foreground text-xl">
                          准备开始网页预览
                        </div>
                        <div className="mt-3 text-muted-foreground text-sm leading-6">
                          输入网址后按 Enter 开始预览
                          <br />
                          拖拽右侧面板时，此预览视口也会跟随自适应缩放
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex h-full min-h-0 min-w-0 items-start justify-center overflow-hidden p-3">
                {viewportLayout ? (
                  <div
                    className="relative shrink-0 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
                    style={frameContainerStyle}
                  >
                    {iframeSrc ? (
                      <iframe
                        ref={iframeRef}
                        key={iframeKey}
                        className="block border-0"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                        src={iframeSrc}
                        style={iframeStyle}
                        title="Preview"
                        onError={handleIframeError}
                        onLoad={handleIframeLoad}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
              {status === "loading" ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                  <div className="text-muted-foreground text-sm">加载中...</div>
                </div>
              ) : null}
              {status === "error" ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                  <div className="text-center">
                    <div className="text-destructive text-sm">无法加载该页面</div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      可能是目标页面设置了不允许嵌入的限制
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </WebPreview>
    </div>
  )
}

const INNER_PADDING = 24

function getPreviewViewportLayout(
  containerWidth: number,
  containerHeight: number
): PreviewViewportLayout | null {
  if (containerWidth <= 0 || containerHeight <= 0) return null

  const availableHeight = containerHeight - INNER_PADDING

  if (containerWidth >= DESKTOP_VIEWPORT_WIDTH) {
    return {
      frameHeight: availableHeight,
      frameWidth: containerWidth,
      renderedHeight: availableHeight,
      renderedWidth: containerWidth,
      scale: 1,
    }
  }

  const scale = containerWidth / DESKTOP_VIEWPORT_WIDTH
  return {
    frameHeight: availableHeight / scale,
    frameWidth: DESKTOP_VIEWPORT_WIDTH,
    renderedHeight: availableHeight,
    renderedWidth: containerWidth,
    scale,
  }
}
