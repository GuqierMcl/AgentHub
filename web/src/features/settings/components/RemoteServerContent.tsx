import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Upload, Server } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { remoteServerApi, type RemoteServer, type CreateRemoteServerInput } from "../api/remote-server-api"
import { RemoteServerCard } from "./RemoteServerCard"
import { RemoteServerDialog } from "./RemoteServerDialog"

export function RemoteServerContent() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<RemoteServer | null>(null)
  const [testStates, setTestStates] = useState<Record<string, { loading: boolean; result?: { success: boolean; message: string } | null }>>({})

  const { data, isLoading } = useQuery({
    queryKey: ["remote-servers"],
    queryFn: async () => {
      const res = await remoteServerApi.list()
      return res.servers
    },
  })

  const createMutation = useMutation({
    mutationFn: (input: CreateRemoteServerInput) => remoteServerApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remote-servers"] })
      toast.success("服务器已添加")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateRemoteServerInput }) => remoteServerApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remote-servers"] })
      toast.success("服务器已更新")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remoteServerApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remote-servers"] })
      toast.success("服务器已删除")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const importMutation = useMutation({
    mutationFn: () => remoteServerApi.importSshConfig(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["remote-servers"] })
      toast.success(`导入完成：新增 ${result.imported}，更新 ${result.updated}`)
      if (result.errors.length > 0) {
        result.errors.forEach((e) => toast.error(e))
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleSave = async (input: CreateRemoteServerInput, id?: string) => {
    if (id) {
      await updateMutation.mutateAsync({ id, input })
    } else {
      await createMutation.mutateAsync(input)
    }
  }

  const handleEdit = (server: RemoteServer) => {
    setEditingServer(server)
    setDialogOpen(true)
  }

  const handleAdd = () => {
    setEditingServer(null)
    setDialogOpen(true)
  }

  const handleTest = async (server: RemoteServer) => {
    setTestStates((prev) => ({ ...prev, [server.id]: { loading: true, result: null } }))
    try {
      const result = await remoteServerApi.testConnection(server.id)
      setTestStates((prev) => ({ ...prev, [server.id]: { loading: false, result } }))
      if (result.success) {
        toast.success(`${server.hostname}: 连接成功`)
      } else {
        toast.error(`${server.hostname}: ${result.message}`)
      }
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [server.id]: { loading: false, result: { success: false, message: String(err) } },
      }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
            <Upload className="mr-1.5 h-4 w-4" />
            {importMutation.isPending ? "导入中..." : "导入 SSH 配置"}
          </Button>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="mr-1.5 h-4 w-4" />
            添加服务器
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Server className="h-12 w-12 mb-3 opacity-40" />
          <p className="text-sm">暂无服务器</p>
          <p className="text-xs mt-1">点击「添加服务器」或「导入 SSH 配置」开始</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {data.map((server) => (
            <RemoteServerCard
              key={server.id}
              server={server}
              onEdit={handleEdit}
              onDelete={(s) => deleteMutation.mutate(s.id)}
              onTest={handleTest}
              testStatus={testStates[server.id]}
            />
          ))}
        </div>
      )}

      <RemoteServerDialog
        key={editingServer?.id ?? 'add-new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        server={editingServer}
        onSave={handleSave}
      />
    </div>
  )
}
