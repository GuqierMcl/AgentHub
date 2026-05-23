import pino from "pino"

export const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  },
  level: process.env.LOG_LEVEL ?? "info",
})

export function createChildLogger(name: string) {
  return logger.child({ module: name })
}