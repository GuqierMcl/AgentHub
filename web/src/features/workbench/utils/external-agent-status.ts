import type {
  ServiceStatusValue,
  SystemServiceStatusItem,
} from "@/features/app-shell/api/service-status"
import {
  getServiceStatusLabel,
  getServiceStatusTone,
  type ServiceStatusTone,
} from "@/features/app-shell/utils/service-status-copy"

import type { ConversationAgentProfile } from "../types"

const EXTERNAL_SERVICE_IDS = ["opencode", "codex", "claude-code"] as const

export type ExternalServiceId = typeof EXTERNAL_SERVICE_IDS[number]

export type ExternalAgentStatusBarItem = {
  id: ExternalServiceId
  label: string
  status: ServiceStatusValue
  statusLabel: string
  tone: ServiceStatusTone
}

export function getExternalAgentStatusBarItems(
  agents: ConversationAgentProfile[],
  services: SystemServiceStatusItem[]
): ExternalAgentStatusBarItem[] {
  const servicesById = new Map(
    services
      .filter((service) => service.kind === "external-agent" && isExternalServiceId(service.id))
      .map((service) => [service.id as ExternalServiceId, service])
  )
  const seen = new Set<ExternalServiceId>()
  const items: ExternalAgentStatusBarItem[] = []

  for (const agent of agents) {
    if (
      agent.enabled === false ||
      !isExternalServiceId(agent.id) ||
      seen.has(agent.id)
    ) {
      continue
    }
    seen.add(agent.id)

    const service = servicesById.get(agent.id)
    const status = service?.status ?? "not_integrated"
    items.push({
      id: agent.id,
      label: service?.label ?? agent.name,
      status,
      statusLabel: getServiceStatusLabel(status),
      tone: getServiceStatusTone(status),
    })
  }

  return items
}

export function isExternalServiceId(value: string): value is ExternalServiceId {
  return (EXTERNAL_SERVICE_IDS as readonly string[]).includes(value)
}
