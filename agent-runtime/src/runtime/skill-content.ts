import { readFile } from "node:fs/promises"
import type {
  CapabilityDiscoveryRequest,
  CapabilityDiscoveryService,
  CapabilityLevel,
  CapabilitySource,
} from "./capabilities"

export const DEFAULT_MAX_SKILL_BODY_CHARS = 12_000
export const DEFAULT_MAX_TOTAL_SKILL_BODY_CHARS = 40_000
export const DEFAULT_MAX_SKILL_COUNT = 20

export type ResolvedSkillContent = {
  id: string
  ref: string
  name: string
  source: CapabilitySource
  level: CapabilityLevel
  body: string
  truncated: boolean
  contentChars: number
  relativeRefs: string[]
  warnings: string[]
}

export type SkillContentResolution = {
  skills: ResolvedSkillContent[]
  warnings: string[]
}

export type SkillContentResolveRequest = {
  skillRefs: string[]
  workspace?: CapabilityDiscoveryRequest["workspace"]
  maxSkillBodyChars?: number
  maxTotalBodyChars?: number
}

export class SkillContentService {
  constructor(private discoveryService: CapabilityDiscoveryService) {}

  async resolve(request: SkillContentResolveRequest): Promise<SkillContentResolution> {
    const skillRefs = normalizeSkillRefs(request.skillRefs).slice(0, DEFAULT_MAX_SKILL_COUNT)
    if (skillRefs.length === 0) return { skills: [], warnings: [] }

    const scope = skillRefs.some((ref) => ref.startsWith("workspace:")) ? "all" : "global"
    const lookups = await this.discoveryService.listSkillLookups({
      scope,
      workspace: request.workspace,
    })
    const lookupByRef = new Map<string, typeof lookups[number]>()
    for (const lookup of lookups) {
      lookupByRef.set(lookup.id, lookup)
      lookupByRef.set(lookup.path, lookup)
    }

    const warnings: string[] = []
    const skills: ResolvedSkillContent[] = []
    const maxSkillBodyChars = request.maxSkillBodyChars ?? DEFAULT_MAX_SKILL_BODY_CHARS
    const maxTotalBodyChars = request.maxTotalBodyChars ?? DEFAULT_MAX_TOTAL_SKILL_BODY_CHARS
    let remainingTotal = maxTotalBodyChars

    for (const skillRef of skillRefs) {
      const lookup = lookupByRef.get(skillRef)
      if (!lookup || !lookup.valid) {
        warnings.push(`Skill ${skillRef} was not found or is not valid.`)
        continue
      }

      if (remainingTotal <= 0) {
        warnings.push(`Skill ${skillRef} was skipped because the total Skill context limit was reached.`)
        continue
      }

      const raw = await readFile(lookup.filePath, "utf-8")
      const body = stripFrontmatter(raw).trim()
      const limit = Math.min(maxSkillBodyChars, remainingTotal)
      const truncated = body.length > limit
      const clipped = truncated ? body.slice(0, limit) : body
      remainingTotal -= clipped.length

      const skillWarnings = [
        ...(truncated ? ["Skill body was truncated."] : []),
        ...(containsShellFence(body)
          ? ["Skill contains shell-like fenced code; Runtime treats it as text and does not execute it."]
          : []),
      ]

      skills.push({
        id: lookup.id,
        ref: lookup.path,
        name: lookup.name,
        source: lookup.source,
        level: lookup.level,
        body: clipped,
        truncated,
        contentChars: clipped.length,
        relativeRefs: extractRelativeRefs(body),
        warnings: skillWarnings,
      })
    }

    return { skills, warnings }
  }
}

function normalizeSkillRefs(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
}

function containsShellFence(content: string): boolean {
  return /```(?:bash|sh|shell|zsh|powershell|pwsh|cmd|bat)\b/i.test(content)
}

function extractRelativeRefs(content: string): string[] {
  const refs = new Set<string>()
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g
  for (const match of content.matchAll(pattern)) {
    const raw = (match[1] ?? "").trim()
    if (
      !raw ||
      raw.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(raw) ||
      raw.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(raw)
    ) {
      continue
    }
    refs.add(raw.replace(/\\/g, "/"))
  }
  return Array.from(refs).sort()
}
