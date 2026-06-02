import { useEffect, useRef, useState, useCallback } from "react"
import * as pdfjsLib from "pdfjs-dist"

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, Maximize2Icon } from "lucide-react"

type PdfPreviewProps = {
  url: string
  name?: string
  onFullscreen?: () => void
}

const ZOOM_OPTIONS = ["auto", 0.5, 0.75, 1, 1.25, 1.5] as const

function isAutoZoom(v: string): v is "auto" {
  return v === "auto"
}

export function PdfPreview({ url, name: _name, onFullscreen }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollAreaHostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [autoFit, setAutoFit] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [resizeTick, setResizeTick] = useState(0)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const pageWidthRef = useRef(0)

  const scrollAreaHostRefCallback = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    scrollAreaHostRef.current = node
    viewportRef.current = node?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null
    if (node) {
      observerRef.current = new ResizeObserver(() => setResizeTick(n => n + 1))
      const target = viewportRef.current ?? node
      observerRef.current.observe(target)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    pdfjsLib.getDocument({ url }).promise.then(async (pdf) => {
      if (cancelled) return
      const page = await pdf.getPage(1)
      pageWidthRef.current = page.getViewport({ scale: 1 }).width
      setPdfDoc(pdf)
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setError("无法加载 PDF 文件")
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
      }
    }
  }, [url])

  const renderPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, s: number) => {
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
    }
    setRendering(true)
    try {
      const page = await doc.getPage(pageNum)
      const viewport = page.getViewport({ scale: s })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      const renderTask = page.render({
        canvas,
        viewport,
        background: "rgb(255 255 255)",
      })
      renderTaskRef.current = renderTask
      await renderTask.promise
      setRendering(false)
    } catch {
      setRendering(false)
    }
  }, [])

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let s = scale
    if (autoFit && pageWidthRef.current) {
      const cw = (viewportRef.current?.clientWidth ?? scrollAreaHostRef.current?.clientWidth ?? 0) - 32
      if (cw > 0) {
        s = Math.max(0.25, Math.min(2, cw / pageWidthRef.current))
      }
    }
    renderPage(pdfDoc, currentPage, s)
  }, [pdfDoc, currentPage, scale, autoFit, renderPage, resizeTick])

  const handlePrevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(1, p - 1))
  }, [])

  const handleNextPage = useCallback(() => {
    setCurrentPage((p) => Math.min(totalPages, p + 1))
  }, [totalPages])

  const handlePageInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10)
      if (value >= 1 && value <= totalPages) {
        setCurrentPage(value)
      }
    },
    [totalPages],
  )

  const handleZoomChange = useCallback((v: string) => {
    if (isAutoZoom(v)) {
      setAutoFit(true)
    } else {
      setAutoFit(false)
      setScale(parseFloat(v))
    }
  }, [])

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="min-h-0 flex-1 rounded" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" disabled={currentPage <= 1} onClick={handlePrevPage}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          <div className="flex items-center gap-1 text-xs">
            <Input
              type="number"
              className="h-7 w-12 text-center text-xs [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
              value={currentPage}
              min={1}
              max={totalPages}
              onChange={handlePageInput}
            />
            <span className="text-muted-foreground">/ {totalPages}</span>
          </div>
          <Button variant="ghost" size="icon-sm" disabled={currentPage >= totalPages} onClick={handleNextPage}>
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Select value={autoFit ? "auto" : String(scale)} onValueChange={handleZoomChange}>
            <SelectTrigger className="h-7 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZOOM_OPTIONS.map((z) => (
                <SelectItem key={String(z)} value={String(z)} className="text-xs">
                  {z === "auto" ? "自适应" : `${Math.round(z * 100)}%`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {onFullscreen && (
            <Button variant="ghost" size="icon-sm" onClick={onFullscreen} aria-label="全屏预览">
              <Maximize2Icon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollAreaHostRefCallback} className="min-h-0 flex-1">
        <ScrollArea className="size-full">
          <div className="flex min-h-full items-start justify-center p-4">
            <div className="relative">
              {rendering && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                  <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              <canvas ref={canvasRef} className="rounded shadow-sm" />
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
