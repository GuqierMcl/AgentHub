import { useCallback, useEffect, useRef, useState } from "react"
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer"
import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type PptxPreviewProps = {
  url: string
  name?: string
  onFullscreen?: () => void
}

export function PptxPreview({ url, onFullscreen }: PptxPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PptxViewer | null>(null)
  const currentSlideRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [slideCount, setSlideCount] = useState(0)
  const [currentSlide, setCurrentSlide] = useState(0)

  useEffect(() => {
    if (!url) return
    let cancelled = false

    async function loadPptx() {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error("无法加载文件")
        const buffer = await res.arrayBuffer()
        if (cancelled || !containerRef.current) return

        const viewer = await PptxViewer.open(buffer, containerRef.current, {
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          listOptions: { windowed: true },
          scrollContainer: holderRef.current ?? undefined,
          onSlideChange: (index: number) => {
            if (cancelled) return
            currentSlideRef.current = index
            setCurrentSlide(index)
          },
        })

        if (cancelled) {
          viewer.destroy()
          return
        }

        viewerRef.current = viewer
        setSlideCount(viewer.slideCount)
        setCurrentSlide(viewer.currentSlideIndex)
        currentSlideRef.current = viewer.currentSlideIndex
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "PPT 预览加载失败")
          setLoading(false)
        }
      }
    }

    loadPptx()

    return () => {
      cancelled = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [url])

  const handlePrevSlide = useCallback(() => {
    const target = currentSlideRef.current - 1
    if (viewerRef.current && target >= 0) {
      viewerRef.current.goToSlide(target, { behavior: "smooth" })
    }
  }, [])

  const handleNextSlide = useCallback(() => {
    const target = currentSlideRef.current + 1
    if (viewerRef.current && target < slideCount) {
      viewerRef.current.goToSlide(target, { behavior: "smooth" })
    }
  }, [slideCount])

  const handleSlideInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10)
      if (value >= 1 && value <= slideCount) {
        viewerRef.current?.goToSlide(value - 1, { behavior: "smooth" })
      }
    },
    [slideCount],
  )

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-border border-b px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={loading || currentSlide <= 0}
            onClick={handlePrevSlide}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <div className="flex items-center gap-1 text-xs">
            <Input
              type="number"
              className="h-7 w-12 text-center text-xs [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
              value={slideCount > 0 ? currentSlide + 1 : 0}
              min={1}
              max={slideCount}
              disabled={loading}
              onChange={handleSlideInput}
            />
            <span className="text-muted-foreground">/ {slideCount}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={loading || currentSlide >= slideCount - 1}
            onClick={handleNextSlide}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">PPT 预览</span>
          {onFullscreen && (
            <Button variant="ghost" size="icon-sm" onClick={onFullscreen} aria-label="全屏预览">
              <Maximize2Icon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div ref={holderRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col gap-3 bg-background p-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="min-h-0 flex-1 rounded" />
          </div>
        )}
        <div
          ref={containerRef}
          className="size-full"
          style={{ display: loading ? "none" : undefined }}
        />
      </div>
    </div>
  )
}
