import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react"

import { Terminal } from "xterm"
import { FitAddon } from "@xterm/addon-fit"

import "xterm/css/xterm.css"
import type { TerminalSettings } from "@/features/settings/api/settings-api"

export type XTermViewHandle = {
  write: (text: string) => void
  clear: () => void
  focus: () => void
  reset: () => void
}

type XTermViewProps = {
  onData?: (data: string) => void
  onResize?: (cols: number, rows: number) => void
  className?: string
  terminalSettings: TerminalSettings
}

export const XTermView = forwardRef<XTermViewHandle, XTermViewProps>(
  function XTermView({ onData, onResize, className, terminalSettings }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const readyRef = useRef(false)
    const pendingBuffer = useRef<string[]>([])
    const onDataRef = useRef(onData)
    const onResizeRef = useRef(onResize)
    const resizeObserverRef = useRef<ResizeObserver | null>(null)

    useEffect(() => { onDataRef.current = onData }, [onData])
    useEffect(() => { onResizeRef.current = onResize }, [onResize])

    useImperativeHandle(
      ref,
      () => ({
        write: (text: string) => {
          if (readyRef.current && terminalRef.current) {
            try {
              terminalRef.current.write(text)
            } catch {
              // ignore
            }
          } else {
            pendingBuffer.current.push(text)
          }
        },
        clear: () => {
          if (readyRef.current && terminalRef.current) {
            terminalRef.current.clear()
          }
        },
        focus: () => {
          terminalRef.current?.focus()
        },
        reset: () => {
          if (readyRef.current && terminalRef.current) {
            terminalRef.current.reset()
          }
        },
      }),
      []
    )

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const containerDiv = container as HTMLElement

      let disposed = false

      const rafId = requestAnimationFrame(() => {
        if (disposed) return
        if (containerDiv.clientWidth <= 0 || containerDiv.clientHeight <= 0) {
          return
        }
        initTerminal()
      })

      function initTerminal() {
        if (disposed || terminalRef.current) return

        let term: Terminal
        let fitAddon: FitAddon

        try {
          term = new Terminal({
            cursorBlink: terminalSettings.cursorBlink,
            cursorStyle: terminalSettings.cursorStyle,
            fontSize: terminalSettings.fontSize,
            fontFamily: terminalSettings.fontFamily,
            allowTransparency: true,
            theme: {
              background: "transparent",
            },
            cols: 80,
            rows: 24,
          })

          fitAddon = new FitAddon()
          term.loadAddon(fitAddon)
        } catch {
          return
        }

        try {
          term.open(containerDiv)
        } catch {
          term.dispose()
          return
        }

        try {
          term.onData((data: string) => {
            onDataRef.current?.(data)
          })
        } catch {
          // non-critical
        }

        terminalRef.current = term
        fitAddonRef.current = fitAddon

        requestAnimationFrame(() => {
          if (disposed) return
          doFit()
        })
      }

      function doFit() {
        if (disposed) return
        const fitAddon = fitAddonRef.current
        if (!fitAddon || containerDiv.clientWidth <= 0 || containerDiv.clientHeight <= 0) return

        try {
          fitAddon.fit()
          const term = terminalRef.current
          if (term && onResizeRef.current) {
            onResizeRef.current(term.cols, term.rows)
          }
        } catch {
          // fit may fail if container is still resolving
        }

        if (!readyRef.current) {
          readyRef.current = true
          const pending = pendingBuffer.current
          pendingBuffer.current = []
          const term = terminalRef.current
          if (term) {
            for (const chunk of pending) {
              try {
                term.write(chunk)
              } catch {
                // ignore
              }
            }
          }
        }
      }

      const ro = new ResizeObserver(() => {
        if (disposed) return
        if (!terminalRef.current) {
          if (containerDiv.clientWidth > 0 && containerDiv.clientHeight > 0) {
            initTerminal()
          }
        } else {
          doFit()
        }
      })
      resizeObserverRef.current = ro
      ro.observe(containerDiv)

      const onWindowResize = () => {
        if (disposed) return
        if (!terminalRef.current) {
          if (containerDiv.clientWidth > 0 && containerDiv.clientHeight > 0) {
            initTerminal()
          }
        } else {
          doFit()
        }
      }
      window.addEventListener("resize", onWindowResize)

      void document.fonts?.ready.then(() => {
        if (disposed) return
        if (!terminalRef.current) {
          if (containerDiv.clientWidth > 0 && containerDiv.clientHeight > 0) {
            initTerminal()
          }
        } else {
          doFit()
        }
      })

      return () => {
        disposed = true
        readyRef.current = false
        cancelAnimationFrame(rafId)
        window.removeEventListener("resize", onWindowResize)
        ro.disconnect()
        resizeObserverRef.current = null
        const t = terminalRef.current
        const f = fitAddonRef.current
        terminalRef.current = null
        fitAddonRef.current = null
        if (f) f.dispose()
        if (t) t.dispose()
      }
    }, [terminalSettings.fontSize, terminalSettings.fontFamily, terminalSettings.cursorBlink, terminalSettings.cursorStyle])

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ height: "100%", width: "100%", minHeight: 0, minWidth: 0 }}
      />
    )
  }
)
