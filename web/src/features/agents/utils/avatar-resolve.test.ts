import { describe, expect, it } from "bun:test"
import {
  getAgentAvatarRenderKey,
  resolveInitials,
  hashAgentSeed,
  resolveOverrideSpec,
  resolveAgentAvatar,
  type AgentAvatarAgent,
} from "../../../lib/avatar-resolve"
import type { AgentOverride } from "../../types"

const agent: AgentAvatarAgent = { id: "coder", name: "Coder", shortName: "CO" }

describe("resolveInitials", () => {
  it("uses shortName when provided", () => {
    expect(resolveInitials({ id: "a", name: "Agent", shortName: "AB" })).toBe("AB")
  })

  it("uppercases shortName", () => {
    expect(resolveInitials({ id: "a", name: "Agent", shortName: "ab" })).toBe("AB")
  })

  it("takes first 2 chars of shortName", () => {
    expect(resolveInitials({ id: "a", name: "Agent", shortName: "ABC" })).toBe("AB")
  })

  it("uses first letter of first two words from name", () => {
    expect(resolveInitials({ id: "a", name: "Open Code", shortName: "" })).toBe("OC")
  })

  it("falls back to first 2 chars of single word name", () => {
    expect(resolveInitials({ id: "a", name: "Coder", shortName: "" })).toBe("CO")
  })

  it("falls back to id when name is empty", () => {
    expect(resolveInitials({ id: "orchestrator", name: "" })).toBe("OR")
  })

  it("splits on underscores", () => {
    expect(resolveInitials({ id: "a", name: "open_code" })).toBe("OC")
  })

  it("splits on hyphens", () => {
    expect(resolveInitials({ id: "a", name: "open-code" })).toBe("OC")
  })
})

describe("hashAgentSeed", () => {
  it("produces deterministic hash", () => {
    const h1 = hashAgentSeed({ id: "coder", name: "Coder" })
    const h2 = hashAgentSeed({ id: "coder", name: "Coder" })
    expect(h1).toBe(h2)
  })

  it("produces different hashes for different agents", () => {
    const h1 = hashAgentSeed({ id: "coder", name: "Coder" })
    const h2 = hashAgentSeed({ id: "writer", name: "Writer" })
    expect(h1).not.toBe(h2)
  })

  it("returns unsigned 32-bit integer", () => {
    const h = hashAgentSeed({ id: "test", name: "Test" })
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(2 ** 32)
  })
})

describe("resolveOverrideSpec", () => {
  it("resolves image override", () => {
    const override: AgentOverride = {
      source: "image",
      file: { relativePath: "files/coder/current.webp", mimeType: "image/webp", width: 256, height: 256, size: 1000 },
    }
    const spec = resolveOverrideSpec(override, agent)
    expect(spec).not.toBeNull()
    expect(spec!.kind).toBe("image")
    if (spec!.kind === "image") {
      expect(spec!.src).toBe("/api/avatar-overrides/coder/file?v=files%2Fcoder%2Fcurrent.webp")
    }
  })

  it("changes image url when the active avatar file changes", () => {
    const first: AgentOverride = {
      source: "image",
      file: { relativePath: "files/coder/first.webp", mimeType: "image/webp", width: 256, height: 256, size: 1000 },
    }
    const second: AgentOverride = {
      source: "image",
      file: { relativePath: "files/coder/second.webp", mimeType: "image/webp", width: 256, height: 256, size: 1000 },
    }

    const firstSpec = resolveOverrideSpec(first, agent)
    const secondSpec = resolveOverrideSpec(second, agent)

    expect(firstSpec).not.toBeNull()
    expect(secondSpec).not.toBeNull()
    expect(firstSpec!.kind).toBe("image")
    expect(secondSpec!.kind).toBe("image")
    if (firstSpec!.kind === "image" && secondSpec!.kind === "image") {
      expect(firstSpec.src).not.toBe(secondSpec.src)
    }
  })

  it("resolves icon override", () => {
    const override: AgentOverride = {
      source: "icon",
      icon: "code2",
      tone: "blue",
    }
    const spec = resolveOverrideSpec(override, agent)
    expect(spec).not.toBeNull()
    expect(spec!.kind).toBe("icon")
    if (spec!.kind === "icon") {
      expect(spec!.iconName).toBe("code2")
      expect(spec!.tone).toBe("blue")
    }
  })

  it("returns null for invalid icon name", () => {
    const override: AgentOverride = {
      source: "icon",
      icon: "nonexistent-icon",
      tone: "blue",
    }
    const spec = resolveOverrideSpec(override, agent)
    expect(spec).toBeNull()
  })

  it("resolves initials override", () => {
    const override: AgentOverride = {
      source: "initials",
      text: "AB",
      tone: "emerald",
      shape: "rounded",
    }
    const spec = resolveOverrideSpec(override, agent)
    expect(spec).not.toBeNull()
    expect(spec!.kind).toBe("initials")
    if (spec!.kind === "initials") {
      expect(spec!.initials).toBe("AB")
      expect(spec!.tone).toBe("emerald")
    }
  })

  it("uppercases initials text", () => {
    const override: AgentOverride = {
      source: "initials",
      text: "ab",
      tone: "rose",
      shape: "circle",
    }
    const spec = resolveOverrideSpec(override, agent)
    expect(spec!.kind).toBe("initials")
    if (spec!.kind === "initials") {
      expect(spec!.initials).toBe("AB")
    }
  })

  it("truncates initials to 2 chars", () => {
    const override: AgentOverride = {
      source: "initials",
      text: "ABC",
      tone: "amber",
      shape: "circle",
    }
    const spec = resolveOverrideSpec(override, agent)
    if (spec!.kind === "initials") {
      expect(spec!.initials).toBe("AB")
    }
  })

  it("returns null for unknown source", () => {
    const override = { source: "unknown" } as unknown as AgentOverride
    const spec = resolveOverrideSpec(override, agent)
    expect(spec).toBeNull()
  })
})

describe("resolveAgentAvatar", () => {
  it("returns override spec when override is provided", () => {
    const override: AgentOverride = {
      source: "icon",
      icon: "brain",
      tone: "violet",
    }
    const spec = resolveAgentAvatar(agent, override)
    expect(spec.kind).toBe("icon")
    if (spec.kind === "icon") {
      expect(spec.iconName).toBe("brain")
      expect(spec.tone).toBe("violet")
    }
  })

  it("returns preset spec when no override and preset exists", () => {
    const presets = {
      coder: { kind: "icon" as const, iconName: "code2", initials: "CO", tone: "blue" as const },
    }
    const spec = resolveAgentAvatar(agent, null, presets)
    expect(spec.kind).toBe("icon")
  })

  it("returns initials fallback when no override and no preset", () => {
    const spec = resolveAgentAvatar({ id: "unknown", name: "Unknown" }, null, {})
    expect(spec.kind).toBe("initials")
    if (spec.kind === "initials") {
      expect(spec.initials).toBe("UN")
    }
  })

  it("falls back to preset when override is null", () => {
    const presets = {
      coder: { kind: "icon" as const, iconName: "code2", initials: "CO", tone: "blue" as const },
    }
    const spec = resolveAgentAvatar(agent, null, presets)
    expect(spec.kind).toBe("icon")
  })

  it("falls back to preset when override is undefined", () => {
    const presets = {
      coder: { kind: "icon" as const, iconName: "code2", initials: "CO", tone: "blue" as const },
    }
    const spec = resolveAgentAvatar(agent, undefined, presets)
    expect(spec.kind).toBe("icon")
  })

  it("uses fallback initials with deterministic tone", () => {
    const h = hashAgentSeed({ id: "test-agent", name: "Test Agent" })
    const tones = ["violet", "blue", "emerald", "rose", "amber", "teal"] as const
    const expectedTone = tones[h % tones.length]

    const spec = resolveAgentAvatar({ id: "test-agent", name: "Test Agent" }, null, {})
    expect(spec.kind).toBe("initials")
    if (spec.kind === "initials") {
      expect(spec.initials).toBe("TA")
      expect(spec.tone).toBe(expectedTone)
    }
  })

  it("prefers override over preset", () => {
    const presets = {
      coder: { kind: "icon" as const, iconName: "code2", initials: "CO", tone: "blue" as const },
    }
    const override: AgentOverride = {
      source: "initials",
      text: "XX",
      tone: "rose",
      shape: "circle",
    }
    const spec = resolveAgentAvatar(agent, override, presets)
    expect(spec.kind).toBe("initials")
    if (spec.kind === "initials") {
      expect(spec.initials).toBe("XX")
    }
  })
})

describe("getAgentAvatarRenderKey", () => {
  it("changes key when avatar switches from image to icon", () => {
    const imageSpec = resolveOverrideSpec({
      source: "image",
      file: { relativePath: "files/coder/current.webp", mimeType: "image/webp", width: 256, height: 256, size: 1000 },
    }, agent)
    const iconSpec = resolveOverrideSpec({
      source: "icon",
      icon: "code2",
      tone: "blue",
    }, agent)

    expect(imageSpec).not.toBeNull()
    expect(iconSpec).not.toBeNull()
    expect(getAgentAvatarRenderKey(imageSpec!)).not.toBe(getAgentAvatarRenderKey(iconSpec!))
  })

  it("changes key when active image source changes", () => {
    const firstImageSpec = resolveOverrideSpec({
      source: "image",
      file: { relativePath: "files/coder/first.webp", mimeType: "image/webp", width: 256, height: 256, size: 1000 },
    }, agent)
    const secondImageSpec = resolveOverrideSpec({
      source: "image",
      file: { relativePath: "files/coder/second.webp", mimeType: "image/webp", width: 256, height: 256, size: 1000 },
    }, agent)

    expect(firstImageSpec).not.toBeNull()
    expect(secondImageSpec).not.toBeNull()
    expect(getAgentAvatarRenderKey(firstImageSpec!)).not.toBe(getAgentAvatarRenderKey(secondImageSpec!))
  })
})
