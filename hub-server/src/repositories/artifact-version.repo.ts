import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type { ArtifactVersionSource, DiffJson } from '../lib/types'

export interface CreateArtifactVersionInput {
  artifactId: string
  version: number
  source: ArtifactVersionSource
  language?: string
  content: string
  summary?: string
  diffJson?: DiffJson
  createdByAgentId?: string
}

export interface UpdateArtifactVersionInput {
  content?: string
  summary?: string | null
  diffJson?: DiffJson | null
}

export interface ArtifactVersionOutput {
  id: string
  artifactId: string
  version: number
  source: string
  language: string | null
  content: string
  summary: string | null
  diffJson: DiffJson | null
  createdByAgentId: string | null
  createdAt: string
}

function toOutput(record: Record<string, unknown>): ArtifactVersionOutput {
  return {
    ...record,
    diffJson: safeJsonParse(record.diffJson as string | undefined, null),
  } as ArtifactVersionOutput
}

export async function createArtifactVersion(input: CreateArtifactVersionInput): Promise<ArtifactVersionOutput> {
  const db = getPrismaClient()
  const record = await db.artifactVersion.create({
    data: {
      id: generateId('ver'),
      artifactId: input.artifactId,
      version: input.version,
      source: input.source,
      language: input.language ?? null,
      content: input.content,
      summary: input.summary ?? null,
      diffJson: input.diffJson ? JSON.stringify(input.diffJson) : null,
      createdByAgentId: input.createdByAgentId ?? null,
      createdAt: new Date().toISOString(),
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findArtifactVersionById(id: string): Promise<ArtifactVersionOutput | null> {
  const db = getPrismaClient()
  const record = await db.artifactVersion.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function findArtifactVersionByArtifactAndVersion(
  artifactId: string,
  version: number,
): Promise<ArtifactVersionOutput | null> {
  const db = getPrismaClient()
  const record = await db.artifactVersion.findUnique({
    where: { artifactId_version: { artifactId, version } },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listArtifactVersionsByArtifact(artifactId: string): Promise<ArtifactVersionOutput[]> {
  const db = getPrismaClient()
  const records = await db.artifactVersion.findMany({
    where: { artifactId },
    orderBy: { version: 'desc' },
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function findLatestArtifactVersion(artifactId: string): Promise<ArtifactVersionOutput | null> {
  const db = getPrismaClient()
  const record = await db.artifactVersion.findFirst({
    where: { artifactId },
    orderBy: { version: 'desc' },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function updateArtifactVersion(
  id: string,
  input: UpdateArtifactVersionInput,
): Promise<ArtifactVersionOutput> {
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {}
  if (input.content !== undefined) data.content = input.content
  if (input.summary !== undefined) data.summary = input.summary
  if (input.diffJson !== undefined) data.diffJson = input.diffJson ? JSON.stringify(input.diffJson) : null

  const record = await db.artifactVersion.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deleteArtifactVersionsByArtifact(artifactId: string) {
  const db = getPrismaClient()
  return db.artifactVersion.deleteMany({ where: { artifactId } })
}
