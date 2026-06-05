import { FileTextIcon, SparklesIcon } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type InstructAgentTemplatePromptProps = {
  templatePrompt: string
}

export function InstructAgentTemplatePrompt({
  templatePrompt,
}: InstructAgentTemplatePromptProps) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <SparklesIcon className="size-4 text-primary" />
          创建提示建议
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm leading-6">
          如果你还没有现成提示词，可以按下面这个模板描述想要创建的智能体。
        </p>
        <div className="rounded-xl border bg-background px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground text-xs">
            <FileTextIcon className="size-3.5" />
            模板提示词
          </div>
          <pre className="whitespace-pre-wrap break-words text-sm leading-6">
            {templatePrompt}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}
