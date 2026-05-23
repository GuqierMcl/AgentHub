import type { SettingsTabId } from "../types"
import { RuntimeContent } from "./RuntimeContent"
import { SkeletonContent } from "./SkeletonContent"

type SettingsContentProps = {
  activeTab: SettingsTabId
}

export function SettingsContent({ activeTab }: SettingsContentProps) {
  return (
    <div className="flex-1 min-h-[400px] overflow-y-auto border-l border-border/50 ml-4 pl-4">
      {activeTab === "runtime" && <RuntimeContent />}
      {activeTab === "provider" && <SkeletonContent />}
      {activeTab === "model" && <SkeletonContent />}
    </div>
  )
}
