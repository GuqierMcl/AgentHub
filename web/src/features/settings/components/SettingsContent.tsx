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
    <ScrollArea className="flex-1 h-full border-l border-border/50 ml-4 pl-4">
      <div className="pr-3">
        {activeTab === "runtime" && <RuntimeContent />}
        {activeTab === "provider" && <ProviderContent />}
        {activeTab === "model" && <ModelContent />}
      </div>
    </ScrollArea>
  )
}