import { create } from "zustand"
import type { AppModuleId } from "@/features/app-shell/app-modules"

type AppNavStore = {
  activeModuleId: AppModuleId
  selectModule: (moduleId: AppModuleId) => void
}

export const useAppNavStore = create<AppNavStore>((set) => ({
  activeModuleId: "chat",
  selectModule: (moduleId) => set({ activeModuleId: moduleId }),
}))
