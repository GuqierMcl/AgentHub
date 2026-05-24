import { APP_NAME } from "@/config/app"
import pkg from "../../../../package.json"

import type { SettingsTabId } from "../types"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/animate-ui/components/radix/sidebar"

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
    <Sidebar collapsible="none" className="w-[160px] bg-background">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>AI 能力</SidebarGroupLabel>
          <SidebarMenu>
            {menuItems.map((item) => (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton
                  isActive={activeTab === item.key}
                  onClick={() => onTabChange(item.key)}
                >
                  {item.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 text-xs" style={{ color: "var(--sidebar-foreground, oklch(0.48 0.015 250))" }}>
          <div className="font-medium">{APP_NAME}</div>
          <div>{pkg.version}</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}