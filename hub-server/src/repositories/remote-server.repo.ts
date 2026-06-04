import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import type { CreateRemoteServerInput, UpdateRemoteServerInput, RemoteServerDTO } from '../domains/remote-server/types'

export interface RemoteServerRecord {
  id: string
  hostname: string
  host: string
  username: string
  port: number
  identityFilePath: string | null
  createdAt: string
  updatedAt: string
}

function toDTO(record: RemoteServerRecord): RemoteServerDTO {
  return {
    id: record.id,
    hostname: record.hostname,
    host: record.host,
    username: record.username,
    port: record.port,
    identityFilePath: record.identityFilePath ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export async function listRemoteServers(): Promise<RemoteServerDTO[]> {
  const prisma = getPrismaClient()
  const records = await prisma.remoteServer.findMany({
    orderBy: { createdAt: 'asc' },
  })
  return records.map(toDTO)
}

export async function findRemoteServerById(id: string): Promise<RemoteServerDTO | null> {
  const prisma = getPrismaClient()
  const record = await prisma.remoteServer.findUnique({ where: { id } })
  return record ? toDTO(record as RemoteServerRecord) : null
}

export async function findRemoteServerByHostname(hostname: string): Promise<RemoteServerDTO | null> {
  const prisma = getPrismaClient()
  const record = await prisma.remoteServer.findFirst({ where: { hostname } })
  return record ? toDTO(record as RemoteServerRecord) : null
}

export async function createRemoteServer(input: CreateRemoteServerInput): Promise<RemoteServerDTO> {
  const prisma = getPrismaClient()
  const now = new Date().toISOString()
  const record = await prisma.remoteServer.create({
    data: {
      id: generateId('rms'),
      hostname: input.hostname,
      host: input.host,
      username: input.username,
      port: input.port ?? 22,
      identityFilePath: input.identityFilePath ?? null,
      createdAt: now,
      updatedAt: now,
    },
  })
  return toDTO(record as RemoteServerRecord)
}

export async function updateRemoteServer(id: string, input: UpdateRemoteServerInput): Promise<RemoteServerDTO> {
  const prisma = getPrismaClient()
  const now = new Date().toISOString()
  const data: Record<string, unknown> = { updatedAt: now }
  if (input.hostname !== undefined) data.hostname = input.hostname
  if (input.host !== undefined) data.host = input.host
  if (input.username !== undefined) data.username = input.username
  if (input.port !== undefined) data.port = input.port
  if (input.identityFilePath !== undefined) data.identityFilePath = input.identityFilePath
  const record = await prisma.remoteServer.update({ where: { id }, data })
  return toDTO(record as RemoteServerRecord)
}

export async function upsertRemoteServerByHostname(
  hostname: string,
  input: CreateRemoteServerInput,
): Promise<{ server: RemoteServerDTO; created: boolean }> {
  const prisma = getPrismaClient()
  const existing = await prisma.remoteServer.findFirst({ where: { hostname } })
  if (existing) {
    const updated = await updateRemoteServer(existing.id, input)
    return { server: updated, created: false }
  }
  const created = await createRemoteServer(input)
  return { server: created, created: true }
}

export async function deleteRemoteServer(id: string): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.remoteServer.delete({ where: { id } })
}
