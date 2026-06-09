import type { ServiceStatusTone } from "@/features/app-shell/utils/service-status-copy"

import type { DeploymentConnectionStatus, DeploymentSnapshot } from "../types"

export type DeploymentSshStatusBarItem = {
  id: string
  label: string
  status: Extract<DeploymentConnectionStatus, "connecting" | "connected">
  statusLabel: string
  tone: ServiceStatusTone
  description?: string
}

export function getDeploymentSshStatusBarItem(
  snapshot: DeploymentSnapshot | null | undefined
): DeploymentSshStatusBarItem | null {
  if (
    !snapshot?.connectionStatus ||
    !isVisibleDeploymentSshStatus(snapshot.connectionStatus)
  ) {
    return null
  }

  const serverLabel =
    snapshot.server?.displayName ??
    snapshot.server?.hostLabel ??
    "远程服务器"

  return {
    id: `deployment-ssh:${snapshot.deploymentId}`,
    label: "SSH",
    status: snapshot.connectionStatus,
    statusLabel: `${getDeploymentSshConnectionStatusLabel(snapshot.connectionStatus)}：${serverLabel}`,
    tone: snapshot.connectionStatus === "connected" ? "success" : "warning",
    ...(snapshot.server?.hostLabel ? { description: snapshot.server.hostLabel } : {}),
  }
}

function isVisibleDeploymentSshStatus(
  status: DeploymentConnectionStatus
): status is DeploymentSshStatusBarItem["status"] {
  return status === "connecting" || status === "connected"
}

function getDeploymentSshConnectionStatusLabel(
  status: DeploymentSshStatusBarItem["status"]
): string {
  switch (status) {
    case "connected":
      return "已连接"
    case "connecting":
      return "连接中"
  }
}
