import {
  CheckCircle2Icon,
  Code2Icon,
  DiffIcon,
  ExternalLinkIcon,
  LayoutPanelTopIcon,
} from "lucide-react"
import type { KeyboardEvent } from "react"

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
import { cn } from "@/lib/utils"

import type { Artifact as WorkbenchArtifact, ArtifactKind } from "../types"

const artifactIconByType = {
  code: Code2Icon,
  preview: LayoutPanelTopIcon,
  diff: DiffIcon,
  deploy: CheckCircle2Icon,
} satisfies Record<ArtifactKind, typeof Code2Icon>

type ArtifactPreviewProps = {
  artifact: WorkbenchArtifact
  onOpen?: (artifact: WorkbenchArtifact) => void
}

export function ArtifactPreview({ artifact, onOpen }: ArtifactPreviewProps) {
  const Icon = artifactIconByType[artifact.type]
  const handleOpen = () => {
    onOpen?.(artifact)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) {
      return
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      handleOpen()
    }
  }

  return (
    <Artifact
      className={cn(
        "max-w-xl shadow-none",
        onOpen &&
          "cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/20"
      )}
      onClick={onOpen ? handleOpen : undefined}
      onKeyDown={handleKeyDown}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
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
        <ArtifactActions>
          <ArtifactAction
            icon={ExternalLinkIcon}
            label="Open artifact"
            onClick={
              onOpen
                ? (event) => {
                    event.stopPropagation()
                    handleOpen()
                  }
                : undefined
            }
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
