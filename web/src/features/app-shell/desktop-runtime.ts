export type DesktopWindowState = {
  maximized: boolean
}

export type DesktopWindowControls = {
  minimize: () => Promise<void>
  close: () => Promise<void>
  toggleMaximize: () => Promise<DesktopWindowState>
  getWindowState: () => Promise<DesktopWindowState>
}

type DesktopWindowRPCSchema = {
  bun: {
    requests: {
      minimize: {
        params: void
        response: void
      }
      close: {
        params: void
        response: void
      }
      toggleMaximize: {
        params: void
        response: DesktopWindowState
      }
      getWindowState: {
        params: void
        response: DesktopWindowState
      }
    }
    messages: Record<never, never>
  }
  webview: {
    requests: Record<never, never>
    messages: Record<never, never>
  }
}

type ElectrobunRuntimeWindow = Window & {
  __electrobunWebviewId?: number
  __electrobunWindowId?: number
}

let controlsPromise: Promise<DesktopWindowControls | null> | null = null
let runtimeBridge:
  | {
      view: unknown
      controls: DesktopWindowControls
    }
  | null = null

export function isElectrobunRuntime(): boolean {
  const runtimeWindow = window as ElectrobunRuntimeWindow

  return (
    typeof runtimeWindow.__electrobunWindowId === "number" &&
    typeof runtimeWindow.__electrobunWebviewId === "number"
  )
}

export function getDesktopWindowControls(): Promise<DesktopWindowControls | null> {
  if (!isElectrobunRuntime()) {
    return Promise.resolve(null)
  }

  controlsPromise ??= createDesktopWindowControls().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`AgentHub desktop controls are unavailable. ${message}`)
    controlsPromise = null
    return null
  })
  return controlsPromise
}

async function createDesktopWindowControls(): Promise<DesktopWindowControls | null> {
  if (runtimeBridge) {
    return runtimeBridge.controls
  }

  const { Electroview } = await import("electrobun/view")
  const rpc = Electroview.defineRPC<DesktopWindowRPCSchema>({
    handlers: {},
    maxRequestTime: 2000,
  })

  const view = new Electroview({ rpc })
  const controls = {
    minimize: () => rpc.request.minimize(),
    close: () => rpc.request.close(),
    toggleMaximize: () => rpc.request.toggleMaximize(),
    getWindowState: () => rpc.request.getWindowState(),
  }

  runtimeBridge = { view, controls }
  return controls
}
