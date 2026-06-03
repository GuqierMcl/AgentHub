import type {
  ServiceStatusValue,
  SystemServiceStatusItem,
} from "../api/service-status"

export type ServiceStatusTone = "success" | "warning" | "danger" | "muted"

const STATUS_LABELS: Record<ServiceStatusValue, string> = {
  running: "运行中",
  starting: "启动中",
  idle: "待命",
  error: "错误",
  not_integrated: "未接入",
}

export function getServiceStatusLabel(status: ServiceStatusValue): string {
  return STATUS_LABELS[status]
}

export function getServiceStatusTone(status: ServiceStatusValue): ServiceStatusTone {
  switch (status) {
    case "running":
      return "success"
    case "starting":
      return "warning"
    case "error":
      return "danger"
    case "idle":
    case "not_integrated":
      return "muted"
  }
}

export function getAggregateServiceStatus(
  services: SystemServiceStatusItem[]
): ServiceStatusValue {
  const implemented = services.filter((service) => service.implemented)
  if (implemented.some((service) => service.status === "error")) {
    return "error"
  }
  if (implemented.some((service) => service.status === "starting")) {
    return "starting"
  }
  if (implemented.some((service) => service.status === "running")) {
    return "running"
  }
  if (implemented.some((service) => service.status === "idle")) {
    return "idle"
  }
  return "not_integrated"
}
