import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { TabInstance } from "@/store/tab-store"
import { RocketIcon } from "lucide-react"
import { RightWorkbenchTabBar } from "./RightWorkbenchTabBar"

describe("RightWorkbenchTabBar layout", () => {
  it("caps long tab titles so they cannot expand the workspace panel", () => {
    const tabs: TabInstance[] = [
      {
        uid: "deploy",
        type: "deploy",
        title:
          "Deploy " +
          "very-long-unbroken-release-title-that-should-not-expand-the-tab-strip-".repeat(8),
        icon: RocketIcon,
      },
    ]

    const html = renderToStaticMarkup(
      <RightWorkbenchTabBar
        activeTabUid="deploy"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onOpenTab={() => {}}
        tabs={tabs}
      />
    )

    expect(html).toContain("max-w-48")
    expect(html).toContain("min-w-0")
    expect(html).toContain('class="min-w-0 truncate"')
  })
})
