import type { DeploymentEvent, ReviewFile, ReviewIssue, WorkspaceFile } from "./types"

export const defaultSelectedFilePath =
  "src/features/app-shell/AppShell.tsx"

export const defaultPreviewTarget = "AgentHub static web preview"

export const reviewFiles: ReviewFile[] = [
  {
    additions: 96,
    deletions: 18,
    path: "src/features/app-shell/AppShell.tsx",
    risk: "medium",
    status: "modified",
    summary: "主布局从两栏扩展为三栏，并接入右侧工作台状态。",
  },
  {
    additions: 142,
    deletions: 0,
    path: "src/features/workbench/right-workbench/RightWorkbench.tsx",
    risk: "low",
    status: "added",
    summary: "新增缓存标签页容器和产物工作台入口。",
  },
  {
    additions: 28,
    deletions: 4,
    path: "src/features/workbench/components/ArtifactPreview.tsx",
    risk: "low",
    status: "review",
    summary: "Artifact 卡片增加打开右侧工作台的静态交互。",
  },
]

export const reviewIssues: ReviewIssue[] = [
  {
    description:
      "右侧面板必须保持 min-h-0 和内部滚动，否则会重新引入页面级滚动条。",
    id: "issue-layout-scroll",
    location: "AppShell.tsx:main grid",
    severity: "P1",
    title: "三栏布局需要锁住滚动边界",
  },
  {
    description:
      "标签页内容应在首次激活后保持挂载，切换时不能重置文件树、草稿或预览滚动位置。",
    id: "issue-tab-cache",
    location: "RightWorkbenchTabView.tsx",
    severity: "P1",
    title: "缓存标签页需要保留局部状态",
  },
  {
    description:
      "Artifact 点击只切换静态状态，不触发真实文件写入、部署或后端请求。",
    id: "issue-static-boundary",
    location: "ArtifactPreview.tsx",
    severity: "P2",
    title: "静态原型边界保持清晰",
  },
]

export const diffPreviewLines = [
  "- <MessageList messages={activeConversation.messages} />",
  "+ <MessageList",
  "+   messages={activeConversation.messages}",
  "+   onOpenArtifact={handleOpenArtifact}",
  "+ />",
  "+ <RightWorkbench",
  "+   activeTab={activeRightTab}",
  "+   selectedArtifact={selectedArtifact}",
  "+ />",
]

export const workspaceFiles: WorkspaceFile[] = [
  {
    group: "Workbench",
    language: "tsx",
    name: "AppShell.tsx",
    path: "src/features/app-shell/AppShell.tsx",
    preview: `export function AppShell() {
  const [activeRightTab, setActiveRightTab] = useState("review")

  return (
    <main className="grid h-svh min-h-0 overflow-hidden">
      <ConversationSidebar />
      <section className="flex min-h-0 flex-col">
        <MessageList />
      </section>
      <RightWorkbench activeTab={activeRightTab} />
    </main>
  )
}`,
    status: "modified",
  },
  {
    group: "Right Workbench",
    language: "tsx",
    name: "RightWorkbench.tsx",
    path: "src/features/workbench/right-workbench/RightWorkbench.tsx",
    preview: `export function RightWorkbench() {
  return (
    <aside className="flex min-h-0 flex-col border-l">
      <WorkbenchTabShell />
    </aside>
  )
}`,
    status: "new",
  },
  {
    group: "Right Workbench",
    language: "tsx",
    name: "RightWorkbenchTabView.tsx",
    path: "src/features/workbench/right-workbench/components/RightWorkbenchTabView.tsx",
    preview: `Activity mode={active ? "visible" : "hidden"} keeps the panel tree mounted after first activation.`,
    status: "new",
  },
  {
    group: "Messages",
    language: "tsx",
    name: "ArtifactPreview.tsx",
    path: "src/features/workbench/components/ArtifactPreview.tsx",
    preview: `Artifact cards can open the matching right-side tab without calling a backend service.`,
    status: "modified",
  },
]

export const deploymentEvents: DeploymentEvent[] = [
  {
    detail: "静态产物已完成本地装配，等待人工检查。",
    id: "prepare",
    state: "done",
    title: "准备预览产物",
  },
  {
    detail: "右侧工作台展示预览、审查和日志入口。",
    id: "preview",
    state: "running",
    title: "生成部署预览",
  },
  {
    detail: "真实部署能力后续由 hub-server 与 agent-runtime 接入。",
    id: "publish",
    state: "waiting",
    title: "等待一键部署",
  },
]

export const deployLogs = [
  "[09:41:18] collect artifacts: 4 static entries",
  "[09:41:20] hydrate preview shell: ok",
  "[09:41:22] run smoke checks: pending manual review",
  "[09:41:25] publish action: disabled in static prototype",
]

export const terminalSessions = [
  {
    id: "term-1",
    title: "终端1",
    lines: [
      "$ bun dev",
      "[0.002] Listening on http://localhost:5173/",
      "[0.015] HMR connected",
      "$ echo AgentHub",
      "AgentHub",
    ],
  },
  {
    id: "term-2",
    title: "终端2",
    lines: [
      "$ cd hub-server && bun dev",
      "[0.001] Listening on http://localhost:3000/",
      "[0.010] HubServer started",
    ],
  },
]

export const browserTargets = [
  { id: "preview-1", title: "浏览器1", url: "https://localhost:4173" },
  { id: "preview-2", title: "浏览器2", url: "https://localhost:3000/api" },
]
