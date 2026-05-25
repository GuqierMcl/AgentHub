import { Badge } from "@/components/ui/badge"

export function RuntimePanel() {
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold">运行时</h2>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">运行状态</h3>
        <div className="rounded-lg border border-border/50 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">健康状态</div>
              <div className="text-sm text-muted-foreground">Agent Runtime 最近一次健康检查结果</div>
            </div>
            <Badge variant="default" className="bg-green-600 hover:bg-green-600">健康</Badge>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">版本</div>
              <div className="text-sm text-muted-foreground">Agent Runtime 健康检查返回的版本</div>
            </div>
            <div className="text-muted-foreground">0.2.0</div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">最近检查</div>
              <div className="text-sm text-muted-foreground">最后一次健康检查完成时间</div>
            </div>
            <div className="text-muted-foreground">2026年5月24日 00:36:44</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">连接信息</h3>
        <div className="rounded-lg border border-border/50 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Endpoint</div>
              <div className="text-sm text-muted-foreground">本机 Agent Runtime 端口</div>
            </div>
            <div className="text-muted-foreground">8787</div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">运行模式</div>
              <div className="text-sm text-muted-foreground">由 Tauri 后端解析得到</div>
            </div>
            <div className="text-muted-foreground">生产模式</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">错误信息</h3>
        <div className="rounded-lg border border-border/50 p-4">
          <div className="text-sm text-muted-foreground">暂无错误信息</div>
        </div>
      </div>
    </div>
  )
}
