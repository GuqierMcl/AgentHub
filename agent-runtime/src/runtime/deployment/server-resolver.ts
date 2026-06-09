import { readFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import type { DeploymentServerSummary } from "./types"

export type DeploymentServerMaterial = DeploymentServerSummary & {
  host: string
  port: number
  username: string
  privateKey?: string
  password?: string
  passphrase?: string
  agent?: string
  readyTimeoutMs?: number
}

type HubDeploymentServersResponse = {
  servers?: DeploymentServerSummary[]
}

export type DeploymentServerResolver = {
  listServers(): Promise<DeploymentServerSummary[]>
  getServerMaterial(serverId: string): Promise<DeploymentServerMaterial>
}

export type HubDeploymentServerResolverOptions = {
  hubCallback?: string
  runtimeToken?: string
}

export class HubDeploymentServerResolver implements DeploymentServerResolver {
  constructor(private options: HubDeploymentServerResolverOptions = {}) {}

  async listServers(): Promise<DeploymentServerSummary[]> {
    const baseUrl = this.requireHubCallback()
    const response = await fetch(new URL("/internal/runtime/deployment/servers", baseUrl), {
      headers: this.createHeaders(),
    })
    if (!response.ok) {
      throw new Error(`HubServer deployment server list failed with ${response.status}`)
    }
    const data = await response.json() as HubDeploymentServersResponse
    return Array.isArray(data.servers) ? data.servers : []
  }

  async getServerMaterial(serverId: string): Promise<DeploymentServerMaterial> {
    const baseUrl = this.requireHubCallback()
    const response = await fetch(new URL(`/internal/runtime/deployment/servers/${encodeURIComponent(serverId)}/material`, baseUrl), {
      headers: this.createHeaders(),
    })
    if (!response.ok) {
      throw new Error(`HubServer deployment server material failed with ${response.status}`)
    }
    const material = await response.json() as DeploymentServerMaterial
    if (!material.id || !material.host || !material.username) {
      throw new Error("HubServer returned invalid deployment server material")
    }
    return material
  }

  private requireHubCallback(): string {
    if (!this.options.hubCallback) {
      throw new Error("Hub callback URL is not configured")
    }
    return this.options.hubCallback
  }

  private createHeaders(): HeadersInit {
    return this.options.runtimeToken
      ? { "x-agenthub-runtime-token": this.options.runtimeToken }
      : {}
  }
}

export class EmptyDeploymentServerResolver implements DeploymentServerResolver {
  async listServers(): Promise<DeploymentServerSummary[]> {
    return []
  }

  async getServerMaterial(): Promise<DeploymentServerMaterial> {
    throw new Error("Deployment server resolver is not configured")
  }
}

export async function resolvePrivateKeyMaterial(identityFilePath?: string | null): Promise<string | undefined> {
  if (identityFilePath) {
    try {
      return await readFile(identityFilePath, "utf-8")
    } catch {
      // Fall through to default keys.
    }
  }

  const defaultKeys = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"]
  for (const keyName of defaultKeys) {
    try {
      return await readFile(join(homedir(), ".ssh", keyName), "utf-8")
    } catch {
      // Try the next key.
    }
  }

  return undefined
}

export function getDefaultSshAgent(): string | undefined {
  return process.env.SSH_AUTH_SOCK || (platform() === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : undefined)
}
