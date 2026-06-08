export type RuntimeHealthStatus = "starting" | "ok" | "error"

export interface RuntimeHealth {
  status: RuntimeHealthStatus
  timestamp: string
  uptime: number
  error?: string
}

export class RuntimeReadiness {
  private status: RuntimeHealthStatus = "starting"
  private errorMessage: string | undefined

  markReady(): void {
    this.status = "ok"
    this.errorMessage = undefined
  }

  markError(_error: unknown): void {
    this.status = "error"
    this.errorMessage = "Agent Runtime failed to initialize"
  }

  getHealth(): RuntimeHealth {
    return {
      status: this.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      ...(this.errorMessage ? { error: this.errorMessage } : {}),
    }
  }
}

export const runtimeReadiness = new RuntimeReadiness()
