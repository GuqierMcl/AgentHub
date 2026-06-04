import { useState } from "react"
import { Server, Pencil, Trash2, Plug, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { RemoteServer } from "../api/remote-server-api"

type RemoteServerCardProps = {
  server: RemoteServer
  onEdit: (server: RemoteServer) => void
  onDelete: (server: RemoteServer) => void
  onTest: (server: RemoteServer) => void
  testStatus?: { loading: boolean; result?: { success: boolean; message: string } | null }
}

export function RemoteServerCard({ server, onEdit, onDelete, onTest, testStatus }: RemoteServerCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  return (
    <Card className="relative">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Server className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm truncate">{server.hostname}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {server.host}:{server.port}
            </p>
            <p className="text-xs text-muted-foreground">{server.username}</p>
            {testStatus?.result && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${testStatus.result.success ? "text-green-600" : "text-red-600"}`}>
                {testStatus.result.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {testStatus.result.message}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onTest(server)}
              disabled={testStatus?.loading}
              title="测试连接"
            >
              {testStatus?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(server)}
              title="编辑"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { onDelete(server); setShowDeleteConfirm(false) }}
                >
                  确认
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
                title="删除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
