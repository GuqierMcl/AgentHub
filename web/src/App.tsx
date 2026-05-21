import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkbenchPage } from "@/features/workbench/WorkbenchPage"

function App() {
  return (
    <TooltipProvider>
      <WorkbenchPage />
    </TooltipProvider>
  )
}

export default App
