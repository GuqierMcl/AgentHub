import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RotateCwIcon } from "lucide-react"

import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from "@/components/ai-elements/web-preview"

type BrowserPanelStatus = "idle" | "loading" | "ready" | "error"
type PreviewViewportLayout = {
  frameHeight: number
  frameWidth: number
  renderedHeight: number
  renderedWidth: number
  scale: number
}

const DESKTOP_VIEWPORT_WIDTH = 1280

type BrowserPanelProps = {
  initialUrl?: string
}

export function BrowserPanel({ initialUrl }: BrowserPanelProps) {
  const normalizedInitialUrl = initialUrl ?? ""
  const [prevInitialUrl, setPrevInitialUrl] = useState(normalizedInitialUrl)
  const [navigatedUrl, setNavigatedUrl] = useState(normalizedInitialUrl)
  const [status, setStatus] = useState<BrowserPanelStatus>(
    initialUrl ? "loading" : "idle"
  )
  const [iframeKey, setIframeKey] = useState(0)
  const [viewportLayout, setViewportLayout] =
    useState<PreviewViewportLayout | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  if (normalizedInitialUrl !== prevInitialUrl) {
    setPrevInitialUrl(normalizedInitialUrl)
    setNavigatedUrl(normalizedInitialUrl)
    setStatus(normalizedInitialUrl ? "loading" : "idle")
  }

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

  const handleUrlChange = useCallback((url: string) => {
    if (!url) return
    setNavigatedUrl(url)
    setStatus("loading")
  }, [])

  const handleIframeLoad = useCallback(() => {
    setStatus("ready")
  }, [])

  const handleIframeError = useCallback(() => {
    setStatus("error")
  }, [])

  const handleRefresh = useCallback(() => {
    if (!navigatedUrl) return
    setIframeKey((k) => k + 1)
    setStatus("loading")
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
      <WebPreview
        className="flex min-h-0 min-w-0 flex-1 flex-col rounded-none border-none bg-transparent"
        defaultUrl={initialUrl ?? ""}
        onUrlChange={handleUrlChange}
      >
        <WebPreviewNavigation>
          <WebPreviewNavigationButton
            disabled={!navigatedUrl}
            onClick={handleRefresh}
            tooltip="刷新"
          >
            <RotateCwIcon className="size-4" />
          </WebPreviewNavigationButton>
          <WebPreviewUrl placeholder="输入网址后按回车访问" />
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
                    <iframe
                      key={iframeKey}
                      className="block border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-top-navigation"
                      src={navigatedUrl}
                      style={iframeStyle}
                      title="Preview"
                      onError={handleIframeError}
                      onLoad={handleIframeLoad}
                    />
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
                      可能是目标页面设置了 X-Frame-Options 或 CSP 限制
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

const INNER_PADDING = 24 // p-3 = 12px each side

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
