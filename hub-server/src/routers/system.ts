import { Hono, type Context } from "hono"
import type { RuntimeClient } from "../lib/runtime"
import { fetchSystemServicesStatusSnapshot } from "../services/service-status.service"

declare module "hono" {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
  }
}

const system = new Hono()

system.get("/api/system/services/status", async (c: Context) => {
  const client = c.get("runtimeClient")
  return c.json(await fetchSystemServicesStatusSnapshot(client))
})

export default system
