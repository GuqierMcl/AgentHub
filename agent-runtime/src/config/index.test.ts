import { describe, expect, test } from "bun:test"
import { loadRuntimeConfig } from "./index"

describe("runtime config", () => {
  test("defaults the Hub callback URL to the development HubServer port", () => {
    const config = loadRuntimeConfig([], {})

    expect(config.hubCallback).toBe("http://127.0.0.1:3000")
  })

  test("prefers the HubServer supplied callback URL over the development default", () => {
    const config = loadRuntimeConfig(
      ["--hub-callback", "http://127.0.0.1:3456"],
      { AGENTHUB_HUB_CALLBACK: "http://127.0.0.1:3000" }
    )

    expect(config.hubCallback).toBe("http://127.0.0.1:3456")
  })
})
