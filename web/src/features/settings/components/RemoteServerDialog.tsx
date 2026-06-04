import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RemoteServer, CreateRemoteServerInput } from "../api/remote-server-api"

type RemoteServerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  server?: RemoteServer | null
  onSave: (input: CreateRemoteServerInput, id?: string) => Promise<void>
}

const defaultForm: CreateRemoteServerInput = {
  hostname: "",
  host: "",
  username: "",
  port: 22,
  identityFilePath: "",
}

export function RemoteServerDialog({ open, onOpenChange, server, onSave }: RemoteServerDialogProps) {
  const [form, setForm] = useState<CreateRemoteServerInput>(defaultForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (server) {
      setForm({
        hostname: server.hostname,
        host: server.host,
        username: server.username,
        port: server.port,
        identityFilePath: server.identityFilePath ?? "",
      })
    } else {
      setForm(defaultForm)
    }
  }, [server, open])

  const handleSave = async () => {
    if (!form.hostname.trim() || !form.host.trim() || !form.username.trim()) return
    setSaving(true)
    try {
      await onSave(form, server?.id)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{server ? "编辑服务器" : "添加服务器"}</DialogTitle>
          <DialogDescription>
            {server ? "修改远程服务器连接信息" : "添加新的远程服务器连接"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="hostname">服务器名</Label>
            <Input
              id="hostname"
              placeholder="生产服务器"
              value={form.hostname}
              onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host">主机地址</Label>
            <Input
              id="host"
              placeholder="192.168.1.100 或 example.com"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                placeholder="root"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port">端口</Label>
              <Input
                id="port"
                type="number"
                placeholder="22"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) || 22 }))}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="identityFilePath">SSH 密钥路径</Label>
            <Input
              id="identityFilePath"
              placeholder="~/.ssh/id_rsa"
              value={form.identityFilePath}
              onChange={(e) => setForm((f) => ({ ...f, identityFilePath: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.hostname.trim() || !form.host.trim() || !form.username.trim()}
          >
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
