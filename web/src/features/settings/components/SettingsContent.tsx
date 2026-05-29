import type { SettingsTabId } from "../types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RuntimeContent } from "./RuntimeContent"
import { ProviderContent } from "./provider/ProviderContent"
import { ModelContent } from "./model/ModelContent"
import { ArchivedContent } from "./ArchivedContent"
import { DiagnosticsContent } from "./DiagnosticsContent"

type SettingsContentProps = {
  activeTab: SettingsTabId
}

const tabLabels: Record<SettingsTabId, string> = {
  runtime: "Agent Runtime",
  provider: "供应商",
  model: "模型",
  archived: "已归档对话",
  diagnostics: "诊断配置",
}

export function SettingsContent({ activeTab }: SettingsContentProps) {
  const isPinnable = activeTab === "provider" || activeTab === "model" || activeTab === "archived" || activeTab === "diagnostics"

  return (
    <div className="flex flex-col h-full border-l border-border/50">
      {isPinnable && (
        <div className="shrink-0 px-4 pt-4 pb-2">
          <h3 className="text-base font-semibold">{tabLabels[activeTab]}</h3>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-2">
          {activeTab === "runtime" && <RuntimeContent />}
          {activeTab === "provider" && <ProviderContent />}
          {activeTab === "model" && <ModelContent />}
          {activeTab === "archived" && <ArchivedContent />}
          {activeTab === "diagnostics" && <DiagnosticsContent />}
        </div>
      </ScrollArea>
    </div>
  )
}