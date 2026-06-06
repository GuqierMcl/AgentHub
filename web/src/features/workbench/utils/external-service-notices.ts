import type { SystemServiceStatusItem } from "@/features/app-shell/api/service-status"
import type {
  ConversationAgentProfile,
  WorkbenchTimelineItem,
  WorkbenchTimelineServiceStatusNoticeItem,
} from "../types"

const EXTERNAL_SERVICE_IDS = ["opencode", "codex", "claude-code"] as const

type ExternalServiceId = typeof EXTERNAL_SERVICE_IDS[number]

export function createAvailableExternalServiceBaselineNotices(input: {
  conversationId: string
  agents: ConversationAgentProfile[]
  services: SystemServiceStatusItem[]
  existingItems: WorkbenchTimelineItem[]
  timestamp: string
}): WorkbenchTimelineServiceStatusNoticeItem[] {
  const conversationExternalServiceIds = new Set<ExternalServiceId>()
  for (const agent of input.agents) {
    if (isExternalServiceId(agent.id)) {
      conversationExternalServiceIds.add(agent.id)
    }
  }
  if (conversationExternalServiceIds.size === 0) return []

  const existingStartedServiceIds = new Set(
    input.existingItems
      .filter((item): item is WorkbenchTimelineServiceStatusNoticeItem =>
        item.kind === "service_status_notice" && item.status === "started"
      )
      .map((item) => item.serviceId)
  )

  return input.services.flatMap((service) => {
    if (
      service.kind !== "external-agent" ||
      !isExternalServiceId(service.id) ||
      !conversationExternalServiceIds.has(service.id) ||
      !isAvailableServiceStatus(service.status) ||
      existingStartedServiceIds.has(service.id)
    ) {
      return []
    }

    return [{
      kind: "service_status_notice",
      id: `service-status:baseline:${input.conversationId}:${service.id}`,
      serviceId: service.id,
      serviceLabel: service.label,
      text: `${service.label} · 已启动`,
      time: input.timestamp,
      status: "started",
    }]
  })
}

function isExternalServiceId(value: string): value is ExternalServiceId {
  return (EXTERNAL_SERVICE_IDS as readonly string[]).includes(value)
}

function isAvailableServiceStatus(status: SystemServiceStatusItem["status"]): boolean {
  return status === "running" || status === "starting" || status === "idle"
}
