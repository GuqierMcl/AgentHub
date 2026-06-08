import { describe, expect, it } from "bun:test"
import { createServer } from "node:net"
import { findAvailablePort } from "./port"

describe("findAvailablePort", () => {
  it("returns a port that can be bound on localhost", async () => {
    const port = await findAvailablePort()

    await new Promise<void>((resolve, reject) => {
      const server = createServer()
      server.once("error", reject)
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve())
      })
    })

    expect(port).toBeGreaterThan(0)
  })
})
