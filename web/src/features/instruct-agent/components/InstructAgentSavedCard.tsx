import { ArrowRightIcon, BotIcon, RotateCcwIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { InstructSavedAgent } from "../types"

type InstructAgentSavedCardProps = {
  agent: InstructSavedAgent
  onContinue: () => void
  onOpenAgent: (agentId: string) => void
}

export function InstructAgentSavedCard({
  agent,
  onContinue,
  onOpenAgent,
}: InstructAgentSavedCardProps) {
  const filesystem = typeof agent.permissionPolicy.filesystem === "string"
    ? agent.permissionPolicy.filesystem
    : "advanced"

  return (
    <Card className="border-primary/25 bg-primary/5 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BotIcon className="size-4 text-primary" />
          智能体已创建
        </CardTitle>
        <CardDescription>{agent.id}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="font-medium text-sm">{agent.name}</div>
          <p className="text-muted-foreground text-sm leading-6">
            {agent.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">工具 {agent.allowedTools.length}</Badge>
          <Badge variant="secondary">子智能体 {agent.allowedSubagents.length}</Badge>
          <Badge variant="secondary">文件权限 {filesystem}</Badge>
        </div>
        {agent.capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.map((capability) => (
              <Badge key={capability} variant="outline">
                {capability}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => onOpenAgent(agent.id)} type="button">
          查看智能体
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
        <Button onClick={onContinue} type="button" variant="outline">
          继续创建
          <RotateCcwIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  )
}
