import {
  CheckCircle2Icon,
  Code2Icon,
  DiffIcon,
  ExternalLinkIcon,
  LayoutPanelTopIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useTabStore } from "@/store/tab-store"
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact"
import { Badge } from "@/components/ui/badge"

import type { Artifact as WorkbenchArtifact, ArtifactKind } from "../types"

const artifactIconByType = {
  code: Code2Icon,
  preview: LayoutPanelTopIcon,
  diff: DiffIcon,
  deploy: CheckCircle2Icon,
} satisfies Record<ArtifactKind, typeof Code2Icon>

type ArtifactPreviewProps = {
  artifact: WorkbenchArtifact
}

export function ArtifactPreview({ artifact }: ArtifactPreviewProps) {
  const Icon = artifactIconByType[artifact.type]
  const openTab = useTabStore((s) => s.openTab)
  const metaParts = artifact.meta
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
  const canOpenDiff = artifact.type === "diff" &&
    Boolean(artifact.detail || (artifact.sourceArtifactId && artifact.conversationId))

  const openDiffReview = () => {
    if (!canOpenDiff) return

    openTab("review", "代码审查", {
      source: artifact.sourceArtifactId ? "artifact" : "live",
      title: artifact.title,
      ...(artifact.sourceArtifactId ? { artifactId: artifact.sourceArtifactId } : {}),
      ...(artifact.conversationId ? { conversationId: artifact.conversationId } : {}),
      ...(artifact.id ? { syntheticId: artifact.id } : {}),
      ...(artifact.detail?.workspaceDiff ? { workspaceDiff: artifact.detail.workspaceDiff } : {}),
      ...(artifact.detail?.patchText ? { patchText: artifact.detail.patchText } : {}),
    })
  }

  return (
    <Artifact
      className={cn(
        "max-w-xl shadow-none",
        canOpenDiff && "cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/20"
      )}
      onClick={openDiffReview}
      onKeyDown={(event) => {
        if (!canOpenDiff) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openDiffReview()
        }
      }}
      role={canOpenDiff ? "button" : undefined}
      tabIndex={canOpenDiff ? 0 : undefined}
    >
      <ArtifactHeader className="gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <ArtifactTitle className="truncate text-xs">
              {artifact.title}
            </ArtifactTitle>
            <ArtifactDescription className="truncate text-xs">
              {artifact.description}
            </ArtifactDescription>
          </div>
        </div>
        {artifact.type !== "diff" ? (
          <ArtifactActions>
            <ArtifactAction
              icon={ExternalLinkIcon}
              label="打开产物"
              tooltip="打开"
            />
          </ArtifactActions>
        ) : null}
      </ArtifactHeader>
      <ArtifactContent className="px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {(metaParts.length ? metaParts : [artifact.meta]).map((part) => (
            <Badge key={part} variant="secondary">
              {part}
            </Badge>
          ))}
        </div>
      </ArtifactContent>
    </Artifact>
  )
}
