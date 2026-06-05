import { Hono, type Context } from "hono"
import { AgentModelRefSchema } from "../agents"
import {
  SystemDefaultModelValidationError,
  type SystemModelSettingsService,
} from "../runtime/system-model-settings"

declare module "hono" {
  interface ContextVariableMap {
    systemModelSettingsService: SystemModelSettingsService
  }
}

const settings = new Hono()

function serviceUnavailable(c: Context) {
  return c.json({
    error: {
      code: "SYSTEM_MODEL_SETTINGS_UNAVAILABLE",
      message: "System model settings service is not initialized",
    },
  }, 503)
}

function invalidInput(c: Context, details: unknown) {
  return c.json({
    error: {
      code: "SYSTEM_DEFAULT_MODEL_INVALID",
      message: "Invalid system default model",
      details,
    },
  }, 400)
}

async function readJsonBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null)
}

settings.get("/runtime/settings/model", (c: Context) => {
  const service = c.get("systemModelSettingsService")
  if (!service) {
    return serviceUnavailable(c)
  }

  return c.json(service.getSettings())
})

settings.put("/runtime/settings/model", async (c: Context) => {
  const service = c.get("systemModelSettingsService")
  if (!service) {
    return serviceUnavailable(c)
  }

  const body = await readJsonBody(c)
  const result = AgentModelRefSchema.safeParse(body)
  if (!result.success) {
    return invalidInput(c, result.error.issues)
  }

  try {
    return c.json(await service.setSystemDefaultModel(result.data))
  } catch (error) {
    if (error instanceof SystemDefaultModelValidationError) {
      return c.json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      }, 400)
    }
    throw error
  }
})

settings.delete("/runtime/settings/model", async (c: Context) => {
  const service = c.get("systemModelSettingsService")
  if (!service) {
    return serviceUnavailable(c)
  }

  return c.json(await service.clearSystemDefaultModel())
})

export default settings
