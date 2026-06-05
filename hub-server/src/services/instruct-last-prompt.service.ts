import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { logger } from '../lib/logger'

type InstructLastPromptFile = {
  lastPrompt?: string
  updatedAt?: string
}

export type InstructLastPromptSnapshot = {
  prompt: string | null
  updatedAt: string | null
}

export class InstructLastPromptService {
  constructor(private readonly filePath: string) {}

  get(): InstructLastPromptSnapshot {
    if (!existsSync(this.filePath)) {
      return emptySnapshot()
    }

    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as InstructLastPromptFile
      const prompt = typeof raw.lastPrompt === 'string' && raw.lastPrompt.trim().length > 0
        ? raw.lastPrompt.trim()
        : null
      const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0
        ? raw.updatedAt
        : null

      if (!prompt || !updatedAt) {
        return emptySnapshot()
      }

      return { prompt, updatedAt }
    } catch (err) {
      logger.warn({ err, filePath: this.filePath }, 'Failed to read instruct last prompt file')
      return emptySnapshot()
    }
  }

  save(prompt: string): InstructLastPromptSnapshot {
    const normalizedPrompt = prompt.trim()
    const snapshot: InstructLastPromptSnapshot = {
      prompt: normalizedPrompt,
      updatedAt: new Date().toISOString(),
    }

    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify({
      lastPrompt: normalizedPrompt,
      updatedAt: snapshot.updatedAt,
    }, null, 2), 'utf8')

    return snapshot
  }
}

function emptySnapshot(): InstructLastPromptSnapshot {
  return {
    prompt: null,
    updatedAt: null,
  }
}
