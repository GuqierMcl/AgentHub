import { useEffect, useState } from "react"
import {
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  getDesktopWindowControls,
  type DesktopWindowControls,
} from "../desktop-runtime"

type DesktopTitleBarProps = {
  onMaximizedChange?: (maximized: boolean) => void
}

function warnWindowControlFailure(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`Unable to ${action} AgentHub window. ${message}`)
}

export function DesktopTitleBar({ onMaximizedChange }: DesktopTitleBarProps) {
  const [controls, setControls] = useState<DesktopWindowControls | null>(null)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let mounted = true

    async function loadControls() {
      const nextControls = await getDesktopWindowControls()
      if (!mounted) {
        return
      }

      setControls(nextControls)

      if (nextControls) {
        try {
          const state = await nextControls.getWindowState()
          if (mounted) {
            setMaximized(state.maximized)
            onMaximizedChange?.(state.maximized)
          }
        } catch (error) {
          warnWindowControlFailure("read", error)
        }
      }
    }

    void loadControls()

    return () => {
      mounted = false
    }
  }, [onMaximizedChange])

  const handleToggleMaximize = async () => {
    if (!controls) {
      return
    }

    try {
      const state = await controls.toggleMaximize()
      setMaximized(state.maximized)
      onMaximizedChange?.(state.maximized)
    } catch (error) {
      warnWindowControlFailure("toggle", error)
    }
  }

  const handleMinimize = async () => {
    if (!controls) {
      return
    }

    try {
      await controls.minimize()
    } catch (error) {
      warnWindowControlFailure("minimize", error)
    }
  }

  const handleClose = async () => {
    if (!controls) {
      return
    }

    try {
      await controls.close()
    } catch (error) {
      warnWindowControlFailure("close", error)
    }
  }

  return (
    <header className="app-region-drag electrobun-webkit-app-region-drag flex h-9 shrink-0 items-center border-border border-b bg-sidebar text-sidebar-foreground">
      <div className="flex min-w-0 items-center gap-2 px-3">
        <img src="/logo.png" alt="" className="size-5 shrink-0 rounded-sm" />
        <span className="truncate text-sm font-medium">AgentHub</span>
      </div>
      <div className="min-w-0 flex-1" />
      <div className="app-region-no-drag electrobun-webkit-app-region-no-drag flex h-full shrink-0 items-center px-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="最小化窗口"
              disabled={!controls}
              onClick={() => void handleMinimize()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <MinusIcon data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>最小化</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={maximized ? "还原窗口" : "最大化窗口"}
              disabled={!controls}
              onClick={() => void handleToggleMaximize()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {maximized ? (
                <Minimize2Icon data-icon="inline-start" />
              ) : (
                <Maximize2Icon data-icon="inline-start" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{maximized ? "还原" : "最大化"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="关闭窗口"
              className="hover:bg-destructive/10 hover:text-destructive"
              disabled={!controls}
              onClick={() => void handleClose()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <XIcon data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>关闭</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
