import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { toast } from "sonner"
import {
  BotIcon,
  Code2Icon,
  SearchIcon,
  EyeIcon,
  PenLineIcon,
  ShieldCheckIcon,
  RouteIcon,
  ListChecksIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
  GlobeIcon,
  DatabaseIcon,
  CloudIcon,
  ServerIcon,
  BookOpenIcon,
  MessageSquareIcon,
  SparklesIcon,
  ZapIcon,
  BrainIcon,
  CogIcon,
  UsersIcon,
  UserIcon,
  WandSparklesIcon,
  BlocksIcon,
  WorkflowIcon,
  GitBranchIcon,
  UploadIcon,
  CheckIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentAvatar } from "@/components/agent-avatar"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import type { AgentAvatarAgent } from "@/components/agent-avatar"
import { avatarOverridesApi } from "@/features/agents/api/avatar-overrides"
import type {
  AgentOverride,
  AvatarOverrideTone,
  AvatarOverrideShape,
} from "@/features/agents/types"
import { useAvatarHistory } from "@/features/agents/hooks/use-avatar-overrides"
import { useSetAvatarOverride, useUploadAvatarImage, useDeleteAvatarOverride, useDeleteAvatarHistory, useRestoreAvatarHistory } from "@/features/agents/hooks/use-mutation-avatar-override"

type IconOption = {
  name: string
  label: string
  icon: LucideIcon
}

const ICON_OPTIONS: IconOption[] = [
  { name: "bot", label: "机器人", icon: BotIcon },
  { name: "code2", label: "代码", icon: Code2Icon },
  { name: "search", label: "搜索", icon: SearchIcon },
  { name: "eye", label: "查看", icon: EyeIcon },
  { name: "pen-line", label: "写作", icon: PenLineIcon },
  { name: "shield-check", label: "审查", icon: ShieldCheckIcon },
  { name: "route", label: "路由", icon: RouteIcon },
  { name: "list-checks", label: "计划", icon: ListChecksIcon },
  { name: "file-text", label: "文件", icon: FileTextIcon },
  { name: "image", label: "图片", icon: ImageIcon },
  { name: "music", label: "音乐", icon: MusicIcon },
  { name: "video", label: "视频", icon: VideoIcon },
  { name: "globe", label: "网络", icon: GlobeIcon },
  { name: "database", label: "数据", icon: DatabaseIcon },
  { name: "cloud", label: "云", icon: CloudIcon },
  { name: "server", label: "服务器", icon: ServerIcon },
  { name: "book-open", label: "文档", icon: BookOpenIcon },
  { name: "message-square", label: "消息", icon: MessageSquareIcon },
  { name: "sparkles", label: "智能", icon: SparklesIcon },
  { name: "zap", label: "快捷", icon: ZapIcon },
  { name: "brain", label: "推理", icon: BrainIcon },
  { name: "cog", label: "设置", icon: CogIcon },
  { name: "users", label: "团队", icon: UsersIcon },
  { name: "user", label: "用户", icon: UserIcon },
  { name: "wand-sparkles", label: "创意", icon: WandSparklesIcon },
  { name: "blocks", label: "模块", icon: BlocksIcon },
  { name: "workflow", label: "流程", icon: WorkflowIcon },
  { name: "git-branch", label: "分支", icon: GitBranchIcon },
]

const TONES: { name: AvatarOverrideTone; className: string }[] = [
  { name: "amber", className: "bg-amber-500" },
  { name: "blue", className: "bg-sky-500" },
  { name: "emerald", className: "bg-emerald-500" },
  { name: "rose", className: "bg-rose-500" },
  { name: "slate", className: "bg-slate-500" },
  { name: "teal", className: "bg-teal-500" },
  { name: "violet", className: "bg-violet-500" },
]

const SHAPES: { name: AvatarOverrideShape; label: string; className: string }[] = [
  { name: "circle", label: "圆形", className: "rounded-full" },
  { name: "rounded", label: "圆角", className: "rounded-lg" },
]

type ActiveTab = "image" | "icon" | "initials"

function getInitialTab(override: AgentOverride | null): ActiveTab {
  if (!override) return "icon"
  if (override.source === "icon") return "icon"
  if (override.source === "initials") return "initials"
  return "image"
}

function getInitialIcon(override: AgentOverride | null): string {
  if (override?.source === "icon") return override.icon
  return "bot"
}

function getInitialTone(override: AgentOverride | null): AvatarOverrideTone {
  if (override && (override.source === "icon" || override.source === "initials")) return override.tone
  return "blue"
}

function getInitialText(override: AgentOverride | null): string {
  if (override?.source === "initials") return override.text
  return ""
}

function getInitialShape(override: AgentOverride | null): AvatarOverrideShape {
  if (override?.source === "initials") return override.shape
  return "circle"
}

export type AvatarEditDialogProps = {
  agent: AgentAvatarAgent
  currentOverride: AgentOverride | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AvatarEditDialog(props: AvatarEditDialogProps) {
  const { open, onOpenChange } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AvatarEditDialogInner key={props.agent.id} {...props} />
    </Dialog>
  )
}

function AvatarEditDialogInner({
  agent,
  currentOverride,
  open,
  onOpenChange,
}: AvatarEditDialogProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => getInitialTab(currentOverride))
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedIcon, setSelectedIcon] = useState(() => getInitialIcon(currentOverride))
  const [selectedTone, setSelectedTone] = useState(() => getInitialTone(currentOverride))
  const [initialsText, setInitialsText] = useState(() => getInitialText(currentOverride))
  const [selectedShape, setSelectedShape] = useState(() => getInitialShape(currentOverride))
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)

  const { data: historyEntries = [] } = useAvatarHistory(agent.id)
  const setOverrideMutation = useSetAvatarOverride()
  const uploadImageMutation = useUploadAvatarImage()
  const deleteOverrideMutation = useDeleteAvatarOverride()
  const deleteHistoryMutation = useDeleteAvatarHistory()
  const restoreHistoryMutation = useRestoreAvatarHistory()

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!open) return
    setActiveTab(getInitialTab(currentOverride))
    setSelectedFile(null)
    setSelectedIcon(getInitialIcon(currentOverride))
    setSelectedTone(getInitialTone(currentOverride))
    setInitialsText(getInitialText(currentOverride))
    setSelectedShape(getInitialShape(currentOverride))
    setSelectedHistoryId(null)
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setLocalPreviewUrl(
      currentOverride?.source === "image"
        ? avatarOverridesApi.imageUrl(agent.id)
        : null,
    )
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, currentOverride, agent.id])

  const liveOverride = useMemo<AgentOverride | null>(() => {
    if (activeTab === "icon") {
      return { source: "icon", icon: selectedIcon, tone: selectedTone }
    }
    if (activeTab === "initials" && initialsText.trim()) {
      return {
        source: "initials",
        text: initialsText.trim().slice(0, 2).toUpperCase(),
        tone: selectedTone,
        shape: selectedShape,
      }
    }
    return null
  }, [activeTab, selectedIcon, selectedTone, initialsText, selectedShape])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]
    if (!allowedTypes.includes(file.type)) {
      toast.error("不支持的文件类型，请上传 PNG、JPG、WebP、GIF 或 SVG 格式")
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("文件大小超过 5MB 限制")
      return
    }

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
    const url = URL.createObjectURL(file)
    previewUrlRef.current = url
    setLocalPreviewUrl(url)
    setSelectedFile(file)
    setSelectedHistoryId(null)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (activeTab === "image") {
        if (selectedHistoryId) {
          await restoreHistoryMutation.mutateAsync({ agentId: agent.id, historyId: selectedHistoryId })
        } else if (selectedFile) {
          await uploadImageMutation.mutateAsync({ agentId: agent.id, file: selectedFile })
        } else {
          toast.error("请选择要上传的图片或从历史记录中选择")
          setSaving(false)
          return
        }
      } else if (activeTab === "icon") {
        await setOverrideMutation.mutateAsync({
          agentId: agent.id,
          override: { source: "icon", icon: selectedIcon, tone: selectedTone },
        })
      } else if (activeTab === "initials") {
        const text = initialsText.trim().slice(0, 2).toUpperCase()
        if (!text) {
          toast.error("请输入 1-2 个字符")
          setSaving(false)
          return
        }
        await setOverrideMutation.mutateAsync({
          agentId: agent.id,
          override: {
            source: "initials",
            text,
            tone: selectedTone,
            shape: selectedShape,
          },
        })
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }, [activeTab, selectedFile, selectedHistoryId, agent.id, selectedIcon, selectedTone, initialsText, selectedShape,
    uploadImageMutation, setOverrideMutation, restoreHistoryMutation, onOpenChange])

  const handleSelectHistory = useCallback((historyId: string) => {
    setSelectedHistoryId(historyId)
    setSelectedFile(null)
    setLocalPreviewUrl(avatarOverridesApi.historyImageUrl(agent.id, historyId))
  }, [agent.id])

  const handleDeleteHistory = useCallback(async (historyId: string) => {
    try {
      await deleteHistoryMutation.mutateAsync({ agentId: agent.id, historyId })
      if (selectedHistoryId === historyId) {
        setSelectedHistoryId(null)
        setLocalPreviewUrl(
          currentOverride?.source === "image"
            ? avatarOverridesApi.imageUrl(agent.id)
            : null,
        )
      }
      toast.success("历史头像已删除")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }, [agent.id, deleteHistoryMutation, selectedHistoryId, currentOverride])

  const handleReset = useCallback(async () => {
    setSaving(true)
    try {
      await deleteOverrideMutation.mutateAsync(agent.id)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复默认失败")
    } finally {
      setSaving(false)
    }
  }, [agent.id, deleteOverrideMutation, onOpenChange])

  const hasSaveableContent =
    activeTab === "image" ? (!!selectedFile || !!selectedHistoryId) :
    activeTab === "icon" ? true :
    !!initialsText.trim()

  return (
    <DialogContent className="w-[640px] max-h-[80vh] flex flex-col" from="top" showCloseButton>
      <DialogHeader>
        <DialogTitle>自定义头像</DialogTitle>
        <DialogDescription>设置 {agent.name} 在本地显示的个性化头像</DialogDescription>
      </DialogHeader>

      <div className="flex justify-center py-4 flex-none">
        {activeTab === "image" && localPreviewUrl ? (
          <img
            src={localPreviewUrl}
            alt="预览"
            className="size-20 rounded-2xl object-cover"
          />
        ) : (
          <AgentAvatar agent={agent} override={liveOverride} size="lg" className="size-20! rounded-2xl" />
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)} className="flex flex-col min-h-0 flex-1">
        <TabsList className="w-full flex-none">
          <TabsTrigger value="image" className="flex-1">上传图片</TabsTrigger>
          <TabsTrigger value="icon" className="flex-1">选择图标</TabsTrigger>
          <TabsTrigger value="initials" className="flex-1">首字母样式</TabsTrigger>
        </TabsList>

        <TabsContent value="image" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="p-1 space-y-4">
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/25 p-8 cursor-pointer hover:border-muted-foreground/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {localPreviewUrl ? (
                  <>
                    <img
                      src={localPreviewUrl}
                      alt="预览"
                      className="size-20 rounded-xl object-cover"
                    />
                    <span className="text-sm text-muted-foreground">点击重新选择</span>
                  </>
                ) : (
                  <>
                    <UploadIcon className="size-10 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">点击上传图片</span>
                    <span className="text-xs text-muted-foreground">支持 PNG、JPG、WebP、GIF、SVG，最大 5MB</span>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {historyEntries.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">历史头像</label>
                  <div className="grid grid-cols-5 gap-2">
                    {historyEntries.map((entry) => {
                      const isSelected = selectedHistoryId === entry.id
                      return (
                        <div
                          key={entry.id}
                          className={cn(
                            "relative aspect-square rounded-lg overflow-hidden group cursor-pointer ring-2 ring-transparent transition-all",
                            isSelected && "ring-ring",
                          )}
                        >
                          <img
                            src={avatarOverridesApi.historyImageUrl(agent.id, entry.id)}
                            alt=""
                            className="size-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1">
                            <button
                              type="button"
                              title="选中"
                              className={cn(
                                "size-7 rounded-full flex items-center justify-center transition-all",
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-white/90 text-foreground opacity-0 group-hover:opacity-100 hover:scale-110",
                              )}
                              onClick={() => handleSelectHistory(entry.id)}
                            >
                              <CheckIcon className="size-4" />
                            </button>
                            <button
                              type="button"
                              title="删除"
                              className="size-7 rounded-full bg-white/90 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 hover:bg-destructive hover:text-destructive-foreground transition-all"
                              onClick={() => handleDeleteHistory(entry.id)}
                            >
                              <Trash2Icon className="size-4" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="icon" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-1">
              <div className="grid grid-cols-7 gap-2">
                {ICON_OPTIONS.map((option) => (
                  <button
                    key={option.name}
                    type="button"
                    title={option.label}
                    className={cn(
                      "flex items-center justify-center rounded-lg p-2 transition-colors",
                      selectedIcon === option.name
                        ? "bg-accent text-accent-foreground ring-2 ring-ring"
                        : "hover:bg-accent/50 text-muted-foreground",
                    )}
                    onClick={() => setSelectedIcon(option.name)}
                  >
                    <option.icon className="size-5" />
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">色板</label>
                <div className="flex gap-2">
                  {TONES.map((tone) => (
                    <button
                      key={tone.name}
                      type="button"
                      title={tone.name}
                      className={cn(
                        "size-7 rounded-full transition-all",
                        tone.className,
                        selectedTone === tone.name && "ring-2 ring-ring ring-offset-2",
                      )}
                      onClick={() => setSelectedTone(tone.name)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="initials" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-1">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="initials-text">
                  文字（1-2 个字符）
                </label>
                <Input
                  id="initials-text"
                  maxLength={2}
                  placeholder="如：AG"
                  value={initialsText}
                  onChange={(e) => setInitialsText(e.target.value.slice(0, 2))}
                  className="max-w-[120px]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">色板</label>
                <div className="flex gap-2">
                  {TONES.map((tone) => (
                    <button
                      key={tone.name}
                      type="button"
                      title={tone.name}
                      className={cn(
                        "size-7 rounded-full transition-all",
                        tone.className,
                        selectedTone === tone.name && "ring-2 ring-ring ring-offset-2",
                      )}
                      onClick={() => setSelectedTone(tone.name)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">形状</label>
                <div className="flex gap-2">
                  {SHAPES.map((shape) => (
                    <button
                      key={shape.name}
                      type="button"
                      className={cn(
                        "flex items-center justify-center px-4 py-1.5 text-sm border rounded-lg transition-all",
                        selectedShape === shape.name
                          ? "border-ring bg-accent"
                          : "border-border hover:bg-accent/50",
                      )}
                      onClick={() => setSelectedShape(shape.name)}
                    >
                      {shape.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        {currentOverride ? (
          <Button variant="ghost" onClick={handleReset} disabled={saving}>
            恢复默认
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          取消
        </Button>
        <Button onClick={handleSave} disabled={saving || !hasSaveableContent}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
