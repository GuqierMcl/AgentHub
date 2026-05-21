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
        <ArtifactActions>
          <ArtifactAction
            icon={ExternalLinkIcon}
            label="Open artifact"
            tooltip="Open"
          />
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className="px-3 py-2">
        <Badge variant="secondary">{artifact.meta}</Badge>
      </ArtifactContent>
    </Artifact>
  )
}
