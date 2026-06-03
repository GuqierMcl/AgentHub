import { Hono } from "hono"
import { createRuntimeServicesStatus, getDefaultOpenCodeServer } from "../runtime"

export const servicesRouter = new Hono()

servicesRouter.get("/runtime/services/status", (c) => {
  return c.json(createRuntimeServicesStatus(getDefaultOpenCodeServer()))
})

export default servicesRouter
