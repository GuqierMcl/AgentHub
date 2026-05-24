import { APP_NAME, APP_VERSION } from "@/config/app"
import { cn } from "@/lib/utils"

import type { SettingsTabId } from "../types"

type SettingsSidebarProps = {
  activeTab: SettingsTabId
  onTabChange: (tab: SettingsTabId) => void
}

const menuItems = [
  { key: "runtime" as SettingsTabId, label: "运行时" },
  { key: "provider" as SettingsTabId, label: "供应商" },
  { key: "model" as SettingsTabId, label: "模型" },
]

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  return (
    <div className="w-[160px] flex flex-col">
      <div className="flex-1">
        <div
          className="mb-3 px-3 text-xs font-medium"
          style={{ color: "rgb(115, 115, 115)" }}
        >
          AI 能力
        </div>
        <nav className="space-y-1">
          {menuItems.map((item) => {
            const isActive = activeTab === item.key
            return (
              <button
                key={item.key}
                onClick={() => onTabChange(item.key)}
                className={cn(
                  "flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "font-medium"
                    : "hover:bg-[rgb(240,240,240)] font-normal"
                )}
                style={{
                  color: "rgb(23, 23, 23)",
                  backgroundColor: isActive ? "rgb(234, 234, 234)" : undefined,
                }}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </div>
      <div className="mt-4 pb-2">
        <div className="text-xs" style={{ color: "rgb(115, 115, 115)" }}>
          <div className="font-medium">{APP_NAME}</div>
          <div>{APP_VERSION}</div>
        </div>
      </div>
    </div>
  )
}
