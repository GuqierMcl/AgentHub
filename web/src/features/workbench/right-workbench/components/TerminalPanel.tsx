import { ScrollArea } from "@/components/ui/scroll-area"

type TerminalPanelProps = {
  uid: string
  title: string
}

const mockLines = [
  "$ bun dev",
  "[0.002] Listening on http://localhost:5173/",
  "[0.015] HMR connected",
  "[1.203] /src/features/workbench/WorkbenchPage.tsx updated",
  "[1.204] Full reload",
  "[2.418] /src/store/tab-store.ts updated",
  "[2.419] HMR: tab-store.ts does not accept its own update",
  "[2.420] Performing full reload",
  "$ git status",
  "On branch feature/right-workbench",
  "Changes not staged for commit:",
  "  modified:   src/features/workbench/right-workbench/RightWorkbench.tsx",
  "  modified:   src/features/workbench/WorkbenchPage.tsx",
  "$ echo hello",
  "hello",
]

export function TerminalPanel({ uid, title }: TerminalPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-border border-b px-3 py-2">
        <div className="truncate font-medium text-xs">{title}</div>
        <div className="truncate text-muted-foreground text-[11px]">
          {uid}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <pre className="p-3 font-mono text-xs leading-5">
          {mockLines.map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </pre>
      </ScrollArea>
    </div>
  )
}
