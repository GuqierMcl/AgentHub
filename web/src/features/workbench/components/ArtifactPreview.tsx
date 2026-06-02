import {
  CheckCircle2Icon,
  Code2Icon,
  DiffIcon,
  ExternalLinkIcon,
  LayoutPanelTopIcon,
} from "lucide-react"

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
  const metaParts = artifact.meta
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)

  return (
    <Artifact className="max-w-xl shadow-none">
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
