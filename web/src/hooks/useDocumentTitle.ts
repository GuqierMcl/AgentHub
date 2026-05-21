import { useEffect } from "react"

import { APP_NAME } from "@/config/app"

type UseDocumentTitleOptions = {
  conversationTitle?: string
}

export function useDocumentTitle({
  conversationTitle,
}: UseDocumentTitleOptions = {}) {
  useEffect(() => {
    document.title = conversationTitle ?? APP_NAME

    return () => {
      document.title = APP_NAME
    }
  }, [conversationTitle])
}
