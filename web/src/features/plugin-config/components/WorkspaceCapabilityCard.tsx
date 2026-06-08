import { ChevronDownIcon, FolderKanbanIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from "@/components/animate-ui/primitives/radix/accordion"

type WorkspaceCapabilityCardProps = {
  title: string
  subtitle: string
  skillCount: number
  mcpCount: number
  children: React.ReactNode
}

export function WorkspaceCapabilityCard({
  title,
  subtitle,
  skillCount,
  mcpCount,
  children,
}: WorkspaceCapabilityCardProps) {
  return (
    <Accordion type="multiple" defaultValue={["item"]} className="overflow-hidden rounded-xl border border-border bg-card">
      <AccordionItem value="item">
        <AccordionHeader>
          <AccordionTrigger className="group/trigger flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <FolderKanbanIcon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <h2 className="truncate text-sm font-semibold">{title}</h2>
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant="secondary" className="text-xs">
                Skill {skillCount}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                MCP {mcpCount}
              </Badge>
            </div>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/trigger:rotate-180" />
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionContent initial={false} className="border-t border-border p-4">
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
