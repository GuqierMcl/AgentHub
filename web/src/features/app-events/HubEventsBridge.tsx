import { useEffect } from "react"

import { hubEventsManager } from "./hub-events-manager"

export function HubEventsBridge() {
  useEffect(() => {
    hubEventsManager.connect()
    return () => {
      hubEventsManager.disconnect()
    }
  }, [])

  return null
}
