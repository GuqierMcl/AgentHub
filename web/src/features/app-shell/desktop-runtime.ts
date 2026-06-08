export type DesktopWindowState = {
  maximized: boolean
}

export type DesktopWindowControls = {
  minimize: () => Promise<void>
  close: () => Promise<void>
  toggleMaximize: () => Promise<DesktopWindowState>
  getWindowState: () => Promise<DesktopWindowState>
}

export type DesktopNotificationOptions = {
  title: string
  body?: string
  subtitle?: string
  silent?: boolean
}

type DesktopNotifications = {
  showNotification: (options: DesktopNotificationOptions) => Promise<void>
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
      showNotification: {
        params: DesktopNotificationOptions
        response: void
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

type DesktopRuntimeBridge = {
  view: unknown
  controls: DesktopWindowControls
  notifications: DesktopNotifications
}

let bridgePromise: Promise<DesktopRuntimeBridge | null> | null = null
let runtimeBridge:
  | DesktopRuntimeBridge
  | null = null

export function isElectrobunRuntime(): boolean {
  const runtimeWindow = window as ElectrobunRuntimeWindow

  return (
    typeof runtimeWindow.__electrobunWindowId === "number" &&
    typeof runtimeWindow.__electrobunWebviewId === "number"
  )
}

export function getDesktopWindowControls(): Promise<DesktopWindowControls | null> {
  return getDesktopRuntimeBridge().then((bridge) => bridge?.controls ?? null)
}

export async function showDesktopNotification(
  options: DesktopNotificationOptions,
): Promise<boolean> {
  const bridge = await getDesktopRuntimeBridge()
  if (!bridge) return false

  try {
    await bridge.notifications.showNotification(options)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`AgentHub desktop notifications are unavailable. ${message}`)
    return false
  }
}

function getDesktopRuntimeBridge(): Promise<DesktopRuntimeBridge | null> {
  if (!isElectrobunRuntime()) {
    return Promise.resolve(null)
  }

  bridgePromise ??= createDesktopRuntimeBridge().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`AgentHub desktop bridge is unavailable. ${message}`)
    bridgePromise = null
    return null
  })
  return bridgePromise
}

async function createDesktopRuntimeBridge(): Promise<DesktopRuntimeBridge | null> {
  if (runtimeBridge) {
    return runtimeBridge
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
  const notifications = {
    showNotification: (options: DesktopNotificationOptions) =>
      rpc.request.showNotification(options),
  }

  runtimeBridge = { view, controls, notifications }
  return runtimeBridge
}
