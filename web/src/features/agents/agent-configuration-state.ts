const ALLOWED_SKILL_REF_PATTERN = /^(global|workspace):(agents|codex|claude-code|opencode):[A-Za-z0-9._:-]+$/
const MAX_ALLOWED_SKILLS = 20

function normalizeAllowedSkillRef(value: string): string {
  return value.trim()
}

export function isAllowedSkillRef(value: string): boolean {
  const ref = normalizeAllowedSkillRef(value)
  return ref.length > 0 && ref.length <= 300 && ALLOWED_SKILL_REF_PATTERN.test(ref)
}

export function appendAllowedSkillRef(
  current: string[],
  value: string,
): { refs: string[]; error?: string } {
  const ref = normalizeAllowedSkillRef(value)
  if (!isAllowedSkillRef(ref)) {
    return {
      refs: current,
      error: "请输入有效的 Skill 逻辑引用。",
    }
  }

  if (current.includes(ref)) {
    return { refs: current }
  }

  if (current.length >= MAX_ALLOWED_SKILLS) {
    return {
      refs: current,
      error: "最多可添加 20 个 Skill。",
    }
  }

  return { refs: [...current, ref] }
}

export function removeAllowedSkillRef(current: string[], value: string): string[] {
  return current.filter((ref) => ref !== value)
}
