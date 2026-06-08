import type { LucideIcon } from "lucide-react"

type TabCardProps = {
  icon: LucideIcon
  title: string
  description: string
  onClick: () => void
}

export function TabCard({ icon: Icon, title, description, onClick }: TabCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[140px] flex-1 flex-col items-center gap-2 rounded-xl border border-border bg-muted/30 p-6 text-center transition-colors hover:bg-muted/60 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-8 text-muted-foreground" />
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{description}</div>
      </div>
    </button>
  )
}
