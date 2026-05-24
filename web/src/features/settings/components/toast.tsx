import { useState, useCallback, createContext, useContext } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { CheckCircleIcon, XCircleIcon, XIcon } from "lucide-react"

type Toast = {
  id: string
  message: string
  type: "success" | "error" | "info"
}

type ToastContextType = {
  addToast: (message: string, type?: Toast["type"]) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const icons = {
    success: <CheckCircleIcon className="size-4 text-green-500" />,
    error: <XCircleIcon className="size-4 text-red-500" />,
    info: null,
  }

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div className="fixed top-4 left-1/2 z-[9999] -translate-x-1/2 flex flex-col gap-2 pointer-events-none">
          <AnimatePresence>
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="pointer-events-auto flex items-center gap-2 rounded-lg border bg-background px-4 py-3 shadow-lg"
              >
                {icons[toast.type]}
                <span className="text-sm">{toast.message}</span>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="ml-2 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}