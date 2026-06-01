"use client";

import { useCallback, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTabStore } from "@/store/tab-store";
import { CheckIcon, CopyIcon, GlobeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

type LinkSafetyModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  url: string;
};

export function LinkSafetyModal({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write may fail in some contexts
    }
  }, [url]);

  const handlePreview = useCallback(() => {
    const store = useTabStore.getState();
    store.openTab("preview", url, { source: "manual", initialUrl: url });
    store.setWorkspaceCollapsed(false);
    onClose();
  }, [url, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="w-[480px] p-4"
        showCloseButton
        from="top"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>打开外部链接？</DialogTitle>
          <DialogDescription>
            您即将访问一个外部网站，请确认链接的安全性
          </DialogDescription>
        </DialogHeader>
        <div className="my-4 rounded-md border bg-muted/30 p-3 font-mono text-sm break-all">
          {url}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckIcon /> 已复制
              </>
            ) : (
              <>
                <CopyIcon /> 复制链接
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={handlePreview}>
            <GlobeIcon /> 网页预览
          </Button>
          <Button variant="default" onClick={onConfirm}>
            打开链接
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
