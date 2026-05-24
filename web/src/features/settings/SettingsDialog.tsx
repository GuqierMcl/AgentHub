import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import type { SettingsTabId } from "./types";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { SettingsContent } from "./components/SettingsContent";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("runtime");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        from="top"
        className="w-[960px] p-4"
        showCloseButton={true}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">用户设置</DialogTitle>
        <DialogDescription className="sr-only">
          管理AI能力相关的运行时、供应商和模型设置
        </DialogDescription>
        <div className="flex h-[600px]">
          <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <SettingsContent activeTab={activeTab} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
