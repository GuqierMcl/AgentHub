import type { SettingsTabId } from "../types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RuntimeContent } from "./RuntimeContent"
import { ProviderContent } from "./provider/ProviderContent"
import { ModelContent } from "./model/ModelContent"

type SettingsContentProps = {
  activeTab: SettingsTabId
}

export function SettingsContent({ activeTab }: SettingsContentProps) {
  return (
    <ScrollArea className="h-full border-l border-border/50">
      <div className="px-4 py-2">
        {activeTab === "runtime" && <RuntimeContent />}
        {activeTab === "provider" && <ProviderContent />}
        {activeTab === "model" && <ModelContent />}
      </div>
    </ScrollArea>
  )
}