import { describe, expect, it } from "bun:test"
import { RuntimeReadiness } from "./readiness"

describe("RuntimeReadiness", () => {
  it("reports starting before Runtime services finish initializing", () => {
    const readiness = new RuntimeReadiness()

    expect(readiness.getHealth()).toMatchObject({
      status: "starting",
    })
  })

  it("reports ok after Runtime services finish initializing", () => {
    const readiness = new RuntimeReadiness()

    readiness.markReady()

    expect(readiness.getHealth()).toMatchObject({
      status: "ok",
    })
  })

  it("reports an error without exposing the original error details", () => {
    const readiness = new RuntimeReadiness()

    readiness.markError(new Error("secret provider token failed"))

    expect(readiness.getHealth()).toMatchObject({
      status: "error",
      error: "Agent Runtime failed to initialize",
    })
  })
})
