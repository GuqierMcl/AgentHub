import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, copyFileSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { config } from '../config'
import { logger } from '../lib/logger'

export type AvatarOverrideTone = 'amber' | 'blue' | 'emerald' | 'rose' | 'slate' | 'teal' | 'violet'

export type AvatarOverrideShape = 'circle' | 'rounded'

export type AvatarOverrideImageFile = {
  relativePath: string
  mimeType: string
  width: number
  height: number
  size: number
}

export type AvatarOverrideHistoryEntry = {
  id: string
  relativePath: string
  mimeType: string
  width: number
  height: number
  size: number
  createdAt: string
}

export type AgentOverride =
  | { source: 'image'; file: AvatarOverrideImageFile; history?: AvatarOverrideHistoryEntry[] }
  | { source: 'icon'; icon: string; tone: AvatarOverrideTone }
  | { source: 'initials'; text: string; tone: AvatarOverrideTone; shape: AvatarOverrideShape }

export type AvatarOverridesManifest = {
  version: number
  updatedAt: string
  agents: Record<string, AgentOverride>
}

export const MAX_HISTORY = 10

const AVATAR_DIR = resolve(config.dataDir, 'avatar-overrides')
const MANIFEST_FILE = resolve(AVATAR_DIR, 'manifest.json')
const FILES_DIR = resolve(AVATAR_DIR, 'files')

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function loadRawManifest(): AvatarOverridesManifest | null {
  if (!existsSync(MANIFEST_FILE)) return null
  try {
    const raw = readFileSync(MANIFEST_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    logger.warn({ err }, 'Failed to parse avatar-overrides manifest, treating as empty')
    return null
  }
}

const DEFAULT_MANIFEST: AvatarOverridesManifest = {
  version: 1,
  updatedAt: '',
  agents: {},
}

export function loadManifest(): AvatarOverridesManifest {
  return loadRawManifest() ?? { ...DEFAULT_MANIFEST, agents: {} }
}

export function getAgentOverride(agentId: string): AgentOverride | null {
  const manifest = loadManifest()
  return manifest.agents[agentId] ?? null
}

export function saveManifest(manifest: AvatarOverridesManifest): void {
  ensureDir(AVATAR_DIR)
  manifest.updatedAt = new Date().toISOString()
  const tmpFile = MANIFEST_FILE + '.tmp'
  writeFileSync(tmpFile, JSON.stringify(manifest, null, 2), 'utf-8')
  renameSync(tmpFile, MANIFEST_FILE)
}

export function setAgentOverride(agentId: string, override: AgentOverride): void {
  const manifest = loadManifest()
  manifest.agents[agentId] = override
  saveManifest(manifest)
}

export function deleteAgentOverride(agentId: string): void {
  const manifest = loadManifest()
  delete manifest.agents[agentId]
  saveManifest(manifest)

  const agentDir = resolve(FILES_DIR, agentId)
  if (existsSync(agentDir)) {
    try {
      rmSync(agentDir, { recursive: true, force: true })
    } catch (err) {
      logger.warn({ err, agentId }, 'Failed to remove avatar files directory')
    }
  }
}

export function getAgentFileDir(agentId: string): string {
  return resolve(FILES_DIR, agentId)
}

export function ensureAgentFileDir(agentId: string): string {
  const dir = getAgentFileDir(agentId)
  ensureDir(dir)
  return dir
}

export function getHistoryDir(agentId: string): string {
  return resolve(getAgentFileDir(agentId), 'history')
}

export function ensureHistoryDir(agentId: string): string {
  const dir = getHistoryDir(agentId)
  ensureDir(dir)
  return dir
}

export function addHistoryEntry(agentId: string, entry: AvatarOverrideHistoryEntry): void {
  const manifest = loadManifest()
  const override = manifest.agents[agentId]
  if (!override || override.source !== 'image') return
  const history = override.history ?? []
  history.push(entry)
  if (history.length > MAX_HISTORY) {
    const removed = history.shift()!
    const removedPath = resolve(AVATAR_DIR, removed.relativePath)
    if (existsSync(removedPath)) {
      try { rmSync(removedPath, { force: true }) } catch { /* ignore */ }
    }
  }
  override.history = history
  saveManifest(manifest)
}

export function removeHistoryEntry(agentId: string, historyId: string): AvatarOverrideHistoryEntry | null {
  const manifest = loadManifest()
  const override = manifest.agents[agentId]
  if (!override || override.source !== 'image' || !override.history) return null
  const idx = override.history.findIndex(h => h.id === historyId)
  if (idx === -1) return null
  const removed = override.history.splice(idx, 1)[0]
  const removedPath = resolve(AVATAR_DIR, removed.relativePath)
  if (existsSync(removedPath)) {
    try { rmSync(removedPath, { force: true }) } catch { /* ignore */ }
  }
  saveManifest(manifest)
  return removed
}

export function getHistoryEntries(agentId: string): AvatarOverrideHistoryEntry[] {
  const manifest = loadManifest()
  const override = manifest.agents[agentId]
  if (!override || override.source !== 'image' || !override.history) return []
  return override.history
}

export function updateImageOverrideFile(agentId: string, file: AvatarOverrideImageFile): void {
  const manifest = loadManifest()
  const override = manifest.agents[agentId]
  if (!override || override.source !== 'image') return
  override.file = file
  saveManifest(manifest)
}

export { AVATAR_DIR, MANIFEST_FILE, FILES_DIR }
