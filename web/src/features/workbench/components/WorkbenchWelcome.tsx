import { MessageSquarePlusIcon, BotIcon } from "lucide-react"

import { GravityStarsBackground } from "@/components/animate-ui/components/backgrounds/gravity-stars"
import { LiquidButton } from "@/components/animate-ui/components/buttons/liquid"
import { TypingAnimation } from "@/components/ui/typing-animation"
import { useAppNavStore } from "@/store/app-nav-store"

const GREETINGS = [
    "你好，今天想做什么 👋",
    "准备好了，开始吧 🚀",
    "有什么可以帮你的 💡",
    "让我们一起创造 ✨",
    "新的一天，新的可能 🌅",
    "你来啦，随时待命 🤖",
    "今天想探索点什么 🔍",
    "灵感已经准备就绪 💫",
    "开始你的下一次协作 🤝",
    "欢迎回来 👋",
    "一起把想法变成现实 💡",
    "准备开启新的对话 💬",
    "今天也会是高效的一天 ⚡",
    "从这里开始你的工作流 🛠️",
    "有什么新的计划吗 📋",
    "开始构建属于你的内容 🎨",
    "正在等待你的指令 ⌨️",
    "一切准备就绪 ✅",
    "新的任务，新的进展 📈",
    "试着输入一个想法 💭",
    "让我们开始处理你的任务 🎯",
    "随时可以开始 ⏰",
    "你的智能工作区已就绪 🧠",
    "下一步，想做什么 🤔",
    "新的灵感正在发生 🌟",
    "欢迎进入协作空间 🏠",
    "今天也一起高效完成任务 💪",
    "准备连接你的智能体 🔗",
    "开始一次新的协同创作 🎭",
    "这里可以帮你完成更多 📦",
    "你的 AI 协作者已经在线 🟢",
    "输入一个目标，然后开始 🎯",
    "开始组织你的想法 📝",
    "从一个问题开始 ❓",
    "把复杂任务交给我们 🧩",
    "现在开始，会发生很多有趣的事 🎉",
    "准备开启今天的创造力 🎨",
    "你的下一次突破，也许就在这里 🔥",
    "想到什么，就开始吧 💭",
    "新的会话，新的上下文 🔄",
    "开始与智能体协作 🤖",
    "你负责想法，我们负责推进 ⚙️",
    "欢迎来到你的 AI 工作台 🖥️",
    "每一次输入，都是新的开始 ✨",
    "把灵感转化为行动 🚀",
    "创建一个对话，开始探索 🗺️",
];

type WorkbenchWelcomeProps = {
  onCreateConversation: () => void
}

export function WorkbenchWelcome({ onCreateConversation }: WorkbenchWelcomeProps) {
  const selectModule = useAppNavStore((s) => s.selectModule)

  return (
      <div className="relative h-full min-h-0 min-w-0">
          <GravityStarsBackground
              className="absolute inset-0 text-foreground"
              starsInteraction
              starsSize={3}
          />
          <div className="pointer-events-none relative flex h-full flex-col items-center justify-center gap-8 p-6">
              <div className="flex flex-col items-center gap-3 text-center animate-fade-in-up">
                  <TypingAnimation
                      words={GREETINGS}
                      cursorStyle="underscore"
                      loop
                      className="text-4xl font-bold tracking-tight"
                  />
                  <p
                      className="max-w-md text-lg text-muted-foreground animate-fade-in-up"
                      style={{ animationDelay: "50ms" }}
                  >
                      创建新会话开始对话，或从左侧选择已有会话继续。
                  </p>
              </div>

              <div
                  className="flex items-center gap-3 animate-fade-in-up"
                  style={{ animationDelay: "100ms" }}
              >
                  <LiquidButton
                      className="pointer-events-auto shadow-lg border border-transparent hover:border-primary-foreground [--liquid-button-background-color:var(--primary)] [--liquid-button-color:var(--primary-foreground)] text-primary-foreground hover:text-primary"
                      onClick={onCreateConversation}
                      type="button"
                  >
                      <MessageSquarePlusIcon data-icon="inline-start" />
                      新建会话
                  </LiquidButton>
                  <LiquidButton
                      className="pointer-events-auto shadow-lg border border-transparent hover:border-primary"
                      variant="ghost"
                      type="button"
                      onClick={() => selectModule("agents")}
                  >
                      <BotIcon data-icon="inline-start" />
                      智能体
                  </LiquidButton>
              </div>
          </div>
      </div>
  );
}
