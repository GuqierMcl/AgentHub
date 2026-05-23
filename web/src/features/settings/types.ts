export type SettingsTabId = "runtime" | "provider" | "model"

export type SettingsTab = {
  id: SettingsTabId
  label: string
}

export type SettingsGroup = {
  title: string
  items: SettingsTab[]
}
