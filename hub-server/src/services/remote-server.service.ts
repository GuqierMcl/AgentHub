import { readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import {
  listRemoteServers,
  findRemoteServerById,
  createRemoteServer,
  updateRemoteServer,
  deleteRemoteServer,
  upsertRemoteServerByHostname,
} from '../repositories/remote-server.repo'
import { notFound } from '../lib/errors'
import type {
  RemoteServerDTO,
  CreateRemoteServerInput,
  UpdateRemoteServerInput,
  ImportResult,
  TestConnectionResult,
  DeploymentServerSummaryDTO,
  DeploymentServerMaterialDTO,
} from '../domains/remote-server/types'

interface ParsedHost {
  hostname: string
  host: string
  username: string
  port: number
  identityFilePath?: string
}

function parseSshConfig(content: string): ParsedHost[] {
  const hosts: ParsedHost[] = []
  const lines = content.split(/\r?\n/)
  let current: Partial<ParsedHost> | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const keywordMatch = line.match(/^(\S+)\s+(.+)$/i)
    if (!keywordMatch) continue

    const [, keyword, value] = keywordMatch
    const kw = keyword.toLowerCase()

    if (kw === 'host') {
      if (current && current.hostname) {
        if (current.host && current.username) {
          hosts.push({
            hostname: current.hostname,
            host: current.host,
            username: current.username,
            port: current.port ?? 22,
            identityFilePath: current.identityFilePath,
          })
        }
      }
      if (value === '*') {
        current = null
        continue
      }
      current = { hostname: value, host: '', username: '', port: 22 }
    } else if (current) {
      switch (kw) {
        case 'hostname':
          current.host = value
          break
        case 'user':
          current.username = value
          break
        case 'port':
          current.port = parseInt(value, 10) || 22
          break
        case 'identityfile':
          current.identityFilePath = value.replace(/^~/, homedir())
          break
      }
    }
  }

  if (current && current.hostname && current.host && current.username) {
    hosts.push({
      hostname: current.hostname,
      host: current.host,
      username: current.username,
      port: current.port ?? 22,
      identityFilePath: current.identityFilePath,
    })
  }

  return hosts
}

export class RemoteServerService {
  async list(): Promise<RemoteServerDTO[]> {
    return listRemoteServers()
  }

  async listForDeployment(): Promise<DeploymentServerSummaryDTO[]> {
    const servers = await listRemoteServers()
    return servers.map((server) => ({
      id: server.id,
      displayName: server.hostname,
      hostLabel: server.host,
      port: server.port,
      user: server.username,
      updatedAt: server.updatedAt,
    }))
  }

  async getDeploymentMaterial(id: string): Promise<DeploymentServerMaterialDTO> {
    const server = await findRemoteServerById(id)
    if (!server) throw notFound('REMOTE_SERVER_NOT_FOUND', 'Server not found')
    const privateKey = this.resolvePrivateKey(server.identityFilePath ?? undefined)
    const agent = process.env.SSH_AUTH_SOCK || (platform() === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)
    return {
      id: server.id,
      displayName: server.hostname,
      hostLabel: server.host,
      host: server.host,
      port: server.port,
      user: server.username,
      username: server.username,
      updatedAt: server.updatedAt,
      ...(typeof privateKey === 'string' ? { privateKey } : {}),
      ...(agent ? { agent } : {}),
    }
  }

  async getById(id: string): Promise<RemoteServerDTO> {
    const server = await findRemoteServerById(id)
    if (!server) throw notFound('REMOTE_SERVER_NOT_FOUND', 'Server not found')
    return server
  }

  async create(input: CreateRemoteServerInput): Promise<RemoteServerDTO> {
    return createRemoteServer(input)
  }

  async update(id: string, input: UpdateRemoteServerInput): Promise<RemoteServerDTO> {
    const server = await findRemoteServerById(id)
    if (!server) throw notFound('REMOTE_SERVER_NOT_FOUND', 'Server not found')
    return updateRemoteServer(id, input)
  }

  async delete(id: string): Promise<void> {
    const server = await findRemoteServerById(id)
    if (!server) throw notFound('REMOTE_SERVER_NOT_FOUND', 'Server not found')
    await deleteRemoteServer(id)
  }

  async importSshConfig(configPath?: string): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, updated: 0, errors: [] }
    const defaultPath = join(homedir(), '.ssh', 'config')
    const filePath = configPath || defaultPath

    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      result.errors.push(`Failed to read SSH config file: ${filePath}`)
      return result
    }

    const hosts = parseSshConfig(content)
    for (const host of hosts) {
      try {
        const { created } = await upsertRemoteServerByHostname(host.hostname, {
          hostname: host.hostname,
          host: host.host,
          username: host.username,
          port: host.port,
          identityFilePath: host.identityFilePath,
        })
        if (created) {
          result.imported++
        } else {
          result.updated++
        }
      } catch (err) {
        result.errors.push(`Failed to import ${host.hostname}: ${String(err)}`)
      }
    }

    return result
  }

  private resolvePrivateKey(identityFilePath?: string): string | Buffer | undefined {
    if (identityFilePath) {
      try {
        return readFileSync(identityFilePath, 'utf-8')
      } catch {
        // specified key not readable, continue
      }
    }

    const home = homedir()
    const defaultKeys = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa']
    for (const keyName of defaultKeys) {
      const keyPath = join(home, '.ssh', keyName)
      try {
        return readFileSync(keyPath, 'utf-8')
      } catch {
        // key not found, continue
      }
    }

    return undefined
  }

  async testConnection(id: string): Promise<TestConnectionResult> {
    const server = await findRemoteServerById(id)
    if (!server) throw notFound('REMOTE_SERVER_NOT_FOUND', 'Server not found')

    return new Promise((resolve) => {
      const conn = new Client()
      const timeout = setTimeout(() => {
        conn.destroy()
        resolve({ success: false, message: 'Connection timed out after 10 seconds' })
      }, 10000)

      conn.on('ready', () => {
        clearTimeout(timeout)
        conn.end()
        resolve({ success: true, message: 'Connection successful' })
      })

      conn.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, message: `Connection failed: ${err.message}` })
      })

      const agent = process.env.SSH_AUTH_SOCK || (platform() === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)

      conn.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey: this.resolvePrivateKey(server.identityFilePath ?? undefined),
        agent,
        readyTimeout: 10000,
        keepaliveInterval: 0,
      })
    })
  }
}
