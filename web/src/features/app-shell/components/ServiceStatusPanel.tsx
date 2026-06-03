import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIcon, CircleIcon, ServerCogIcon } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  fetchSystemServicesStatus,
  type ServiceStatusValue,
  type SystemServiceStatusItem,
  type SystemServicesStatusResponse,
} from "../api/service-status"
import {
  getAggregateServiceStatus,
  getServiceStatusLabel,
  getServiceStatusTone,
  type ServiceStatusTone,
} from "../utils/service-status-copy"

type ServiceStatusPanelProps = {
  collapsed: boolean
}

const POLL_INTERVAL_MS = 7000

const FALLBACK_SERVICES: SystemServiceStatusItem[] = [
  createFallbackService("agent-runtime", "AgentRuntime", "runtime", "error", true),
  createFallbackService("opencode", "OpenCode", "external-agent", "error", true),
  createFallbackService("codex", "Codex", "external-agent", "not_integrated", false),
  createFallbackService("claude-code", "Claude Code", "external-agent", "not_integrated", false),
]

export function ServiceStatusPanel({ collapsed }: ServiceStatusPanelProps) {
  const [status, setStatus] = useState<SystemServicesStatusResponse | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchSystemServicesStatus(signal)
      setStatus(next)
    } catch {
      setStatus({
        checkedAt: new Date().toISOString(),
        services: FALLBACK_SERVICES.map((service) => ({
          ...service,
          checkedAt: new Date().toISOString(),
        })),
      })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refresh])

  const services = status?.services ?? FALLBACK_SERVICES
  const aggregateStatus = useMemo(
    () => getAggregateServiceStatus(services),
    [services]
  )

  if (collapsed) {
    return (
      <div className="shrink-0 px-3 pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={`系统服务状态：${getServiceStatusLabel(aggregateStatus)}`}
              className="relative flex h-9 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              type="button"
            >
              <ServerCogIcon size={19} />
              <StatusDot
                className="absolute right-2 bottom-2"
                status={aggregateStatus}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <ServiceStatusTooltip services={services} />
          </TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="space-y-1 border-border/70 border-t pt-3">
        <div className="flex items-center gap-2 px-2 pb-1 text-muted-foreground text-xs">
          <ActivityIcon size={14} />
          <span className="min-w-0 truncate">系统服务</span>
        </div>
        <div className="space-y-0.5">
          {services.map((service) => (
            <ServiceStatusRow key={service.id} service={service} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ServiceStatusRow({ service }: { service: SystemServiceStatusItem }) {
  const label = getServiceStatusLabel(service.status)
  return (
    <div className="flex min-h-7 items-center gap-2 rounded-md px-2 text-xs">
      <StatusDot status={service.status} />
      <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
        {service.label}
      </span>
      <span className={cn("shrink-0", getToneTextClass(getServiceStatusTone(service.status)))}>
        {label}
      </span>
    </div>
  )
}

function ServiceStatusTooltip({ services }: { services: SystemServiceStatusItem[] }) {
  return (
    <div className="min-w-40 space-y-1">
      {services.map((service) => (
        <div key={service.id} className="flex items-center justify-between gap-4 text-xs">
          <span>{service.label}</span>
          <span className={getToneTextClass(getServiceStatusTone(service.status))}>
            {getServiceStatusLabel(service.status)}
          </span>
        </div>
      ))}
    </div>
  )
}

function StatusDot({
  status,
  className,
}: {
  status: ServiceStatusValue
  className?: string
}) {
  return (
    <CircleIcon
      className={cn(
        "size-2.5 fill-current stroke-none",
        getToneDotClass(getServiceStatusTone(status)),
        className
      )}
    />
  )
}

function getToneDotClass(tone: ServiceStatusTone): string {
  switch (tone) {
    case "success":
      return "text-emerald-500"
    case "warning":
      return "text-amber-500"
    case "danger":
      return "text-destructive"
    case "muted":
      return "text-muted-foreground/60"
  }
}

function getToneTextClass(tone: ServiceStatusTone): string {
  switch (tone) {
    case "success":
      return "text-emerald-600 dark:text-emerald-400"
    case "warning":
      return "text-amber-600 dark:text-amber-400"
    case "danger":
      return "text-destructive"
    case "muted":
      return "text-muted-foreground"
  }
}

function createFallbackService(
  id: SystemServiceStatusItem["id"],
  label: string,
  kind: SystemServiceStatusItem["kind"],
  status: ServiceStatusValue,
  implemented: boolean
): SystemServiceStatusItem {
  return {
    id,
    label,
    kind,
    status,
    implemented,
    checkedAt: new Date(0).toISOString(),
  }
}
