import { describe, expect, it } from "bun:test"

import { avatarPresets } from "./agent-avatar-constants"

describe("avatarPresets", () => {
  it("gives the Deploy system agent an icon preset", () => {
    expect(avatarPresets.deploy).toMatchObject({
      kind: "icon",
      initials: "DP",
      tone: "teal",
    })
  })
})
