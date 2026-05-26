import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell } from "@/features/app-shell/AppShell"

function App() {
  return (
    <TooltipProvider>
      <AppShell />
    </TooltipProvider>
  )
}

export default App
