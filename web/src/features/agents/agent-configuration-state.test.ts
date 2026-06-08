import { describe, expect, test } from "bun:test"

import {
  appendAllowedSkillRef,
  isAllowedSkillRef,
  removeAllowedSkillRef,
} from "./agent-configuration-state"

describe("agent configuration Skill helpers", () => {
  test("accepts trimmed global and workspace logical Skill refs", () => {
    expect(isAllowedSkillRef(" global:agents:review ")).toBe(true)
    expect(isAllowedSkillRef("workspace:codex:.system:openai-docs")).toBe(true)
  })

  test("rejects paths and unknown Skill sources", () => {
    expect(isAllowedSkillRef("D:\\Workspace\\.agents\\skills\\review")).toBe(false)
    expect(isAllowedSkillRef("workspace:unknown:review")).toBe(false)
    expect(isAllowedSkillRef("global:agents:")).toBe(false)
  })

  test("adds normalized refs once and preserves existing order", () => {
    expect(appendAllowedSkillRef(["global:agents:review"], " global:agents:review ")).toEqual({
      refs: ["global:agents:review"],
    })
    expect(appendAllowedSkillRef(["global:agents:review"], "workspace:agents:local-review")).toEqual({
      refs: ["global:agents:review", "workspace:agents:local-review"],
    })
  })

  test("reports invalid refs and the 20 ref limit without mutating current refs", () => {
    const refs = Array.from({ length: 20 }, (_, index) => `global:agents:skill-${index}`)

    expect(appendAllowedSkillRef(["global:agents:review"], "not-a-ref")).toEqual({
      refs: ["global:agents:review"],
      error: "请输入有效的 Skill 逻辑引用。",
    })
    expect(appendAllowedSkillRef(refs, "global:agents:extra")).toEqual({
      refs,
      error: "最多可添加 20 个 Skill。",
    })
  })

  test("removes a selected ref", () => {
    expect(removeAllowedSkillRef([
      "global:agents:review",
      "workspace:agents:local-review",
    ], "global:agents:review")).toEqual(["workspace:agents:local-review"])
  })
})
