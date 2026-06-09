import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { DeploymentSnapshot } from "../../types"
import { DeployPreviewPanelContent } from "./DeployPreviewPanel"

const longTitle =
  "Deploy " +
  "very-long-unbroken-release-title-that-should-not-expand-the-preview-panel-".repeat(8)

describe("DeployPreviewPanel layout", () => {
  it("constrains long deployment titles to the parent width", () => {
    const snapshot: DeploymentSnapshot = {
      version: 1,
      deploymentId: "deployment_long_title",
      conversationId: "conv_deploy",
      status: "running",
      title: longTitle,
      server: {
        id: "server_1",
        displayName: "Production",
        hostLabel: "prod.example.com",
        user: "deploy",
      },
      connectionStatus: "connected",
      progress: {
        percent: 25,
        message: "Deploying",
        updatedAt: "2026-06-09T12:00:00.000Z",
      },
      commands: [],
      logs: [],
      updatedAt: "2026-06-09T12:00:00.000Z",
    }

    const html = renderToStaticMarkup(
      <DeployPreviewPanelContent
        disconnecting={false}
        onDisconnect={() => {}}
        onOpenPreview={() => {}}
        snapshot={snapshot}
      />
    )

    expect(html).toContain(longTitle)
    expect(html).toContain(
      'class="flex h-full min-h-0 w-full min-w-0 max-w-full flex-1 basis-0 flex-col overflow-hidden bg-background"'
    )
    expect(html).toContain(
      'class="flex min-w-0 max-w-full flex-1 items-center gap-2 overflow-hidden"'
    )
    expect(html).toContain('class="min-w-0 flex-1 overflow-hidden"')
    expect(html).toContain(
      'class="w-full min-w-0 max-w-full truncate font-medium text-sm"'
    )
    expect(html).toContain(
      'class="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-x-hidden overflow-y-auto"'
    )
    expect(html).not.toContain('data-slot="scroll-area"')
  })
})
