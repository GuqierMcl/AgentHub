import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
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

export type AgentOverride =
  | { source: 'image'; file: AvatarOverrideImageFile }
  | { source: 'icon'; icon: string; tone: AvatarOverrideTone }
  | { source: 'initials'; text: string; tone: AvatarOverrideTone; shape: AvatarOverrideShape }

export type AvatarOverridesManifest = {
  version: number
  updatedAt: string
  agents: Record<string, AgentOverride>
}

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

export { AVATAR_DIR, MANIFEST_FILE, FILES_DIR }
