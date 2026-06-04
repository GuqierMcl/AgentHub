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
          <SidebarGroupLabel>会话管理</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem key="archived">
              <SidebarMenuButton
                isActive={activeTab === "archived"}
                onClick={() => onTabChange("archived")}
              >
                已归档会话
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>会话设置</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem key="diagnostics">
              <SidebarMenuButton
                isActive={activeTab === "diagnostics"}
                onClick={() => onTabChange("diagnostics")}
              >
                输出设置
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>界面设置</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem key="editor">
              <SidebarMenuButton
                isActive={activeTab === "editor"}
                onClick={() => onTabChange("editor")}
              >
                编辑器
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem key="terminal">
              <SidebarMenuButton
                isActive={activeTab === "terminal"}
                onClick={() => onTabChange("terminal")}
              >
                终端
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
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