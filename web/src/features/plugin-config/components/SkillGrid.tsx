import { InfoIcon } from "lucide-react"
import { SkillCard } from "./SkillCard"
import type { SkillItem } from "../types"

type SkillGridProps = {
  skills: SkillItem[]
  loading: boolean
  error: string | null
  notice?: string | null
  onRetry: () => void
}

export function SkillGrid({ skills, loading, error, notice, onRetry }: SkillGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-2 text-center">
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
          <p className="text-sm text-muted-foreground">正在加载 Skill...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary/80"
        >
          重试
        </button>
      </div>
    )
  }

  if (notice) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <InfoIcon className="size-8 text-blue-500/60" />
        <p className="text-sm text-muted-foreground">{notice}</p>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <div className="rounded-full bg-muted p-4">
          <svg
            className="size-8 text-muted-foreground/40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">暂无发现 Skill</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} />
      ))}
    </div>
  )
}
