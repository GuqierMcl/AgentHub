import { Activity, useCallback, useEffect, useMemo, useState } from "react"
import { Toaster } from "sonner"

import { useDocumentTitle } from "@/hooks/useDocumentTitle"
import { cn } from "@/lib/utils"
import { useAppNavStore } from "@/store/app-nav-store"

import { SettingsDialog } from "@/features/settings/SettingsDialog"

import { appModules, type AppModuleId } from "./app-modules"
import { AppNavigation } from "./components/AppNavigation"
import { DesktopTitleBar } from "./components/DesktopTitleBar"
import { isElectrobunRuntime } from "./desktop-runtime"

export function AppShell() {
  const activeModuleId = useAppNavStore((s) => s.activeModuleId)
  const selectModule = useAppNavStore((s) => s.selectModule)
  const [mountedModuleIds, setMountedModuleIds] = useState<Set<AppModuleId>>(
    () => new Set(["chat"])
  )
  const [isNavigationCollapsed, setIsNavigationCollapsed] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [desktopMaximized, setDesktopMaximized] = useState(false)
  const isDesktopRuntime = isElectrobunRuntime()
  const activeModule = useMemo(
    () => appModules.find((module) => module.id === activeModuleId) ?? appModules[0],
    [activeModuleId]
  )

  useDocumentTitle({
    conversationTitle: activeModule.title,
  })

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  const handleSelectModule = useCallback((moduleId: AppModuleId) => {
    setMountedModuleIds((mountedIds) => new Set([...mountedIds, moduleId]))
    selectModule(moduleId)
  }, [selectModule])

  useEffect(() => {
    document.documentElement.classList.toggle(
      "agenthub-desktop-runtime",
      isDesktopRuntime
    )

    return () => {
      document.documentElement.classList.remove("agenthub-desktop-runtime")
    }
  }, [isDesktopRuntime])

  const shell = (
    <main
      className={cn(
        "grid min-h-0 overflow-hidden bg-muted text-foreground",
        isDesktopRuntime ? "h-full" : "h-svh",
        isNavigationCollapsed
          ? "grid-cols-[4.25rem_minmax(0,1fr)]"
          : "grid-cols-[14rem_minmax(0,1fr)]"
      )}
    >
      <AppNavigation
        activeModuleId={activeModuleId}
        collapsed={isNavigationCollapsed}
        showBrand={!isDesktopRuntime}
        modules={appModules}
        onOpenSettings={handleOpenSettings}
        onSelectModule={handleSelectModule}
        onToggleCollapsed={() =>
          setIsNavigationCollapsed((collapsed) => !collapsed)
        }
      />
      <div className="relative h-full min-h-0 min-w-0 overflow-hidden bg-background">
        {appModules.map((module) => {
          if (!mountedModuleIds.has(module.id)) {
            return null
          }

          const isActive = module.id === activeModuleId
          const ModuleComponent = module.component

          return (
            <Activity
              key={module.id}
              mode={isActive ? "visible" : "hidden"}
              name={`app-module-${module.id}`}
            >
              <div
                aria-hidden={!isActive}
                className={cn(
                  "absolute inset-0 min-h-0 min-w-0",
                  isActive ? "block" : "hidden"
                )}
              >
                <ModuleComponent />
              </div>
            </Activity>
          )
        })}
      </div>
    </main>
  )

  return (
    <>
      {isDesktopRuntime ? (
        <div
          className={cn(
            "flex h-svh min-h-0 flex-col overflow-hidden bg-muted text-foreground",
            !desktopMaximized && "rounded-[12px] border border-border"
          )}
        >
          <DesktopTitleBar onMaximizedChange={setDesktopMaximized} />
          <div className="min-h-0 flex-1">{shell}</div>
        </div>
      ) : (
        shell
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <Toaster position="top-center" richColors />
    </>
  )
}
