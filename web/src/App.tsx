import { QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { HubEventsBridge } from "@/features/app-events/HubEventsBridge"
import { AppShell } from "@/features/app-shell/AppShell"
import { queryClient } from "@/lib/query-client"

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <HubEventsBridge />
        <AppShell />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
