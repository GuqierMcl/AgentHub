import { MessageSquarePlusIcon, SparklesIcon } from "lucide-react";

import { GravityStarsBackground } from "@/components/animate-ui/components/backgrounds/gravity-stars";
import { Button } from "@/components/ui/button";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";

type WorkbenchWelcomeProps = {
    onCreateConversation: () => void;
};

export function WorkbenchWelcome({
    onCreateConversation,
}: WorkbenchWelcomeProps) {
    return (
        <div className="relative h-full min-h-0 min-w-0">
            <GravityStarsBackground
                className="absolute inset-0 text-foreground"
                starsInteraction={true}
                starsSize={3}
            />
            <div className="pointer-events-none relative flex h-full items-center justify-center p-6">
                <Empty className="max-w-xl border-0">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <SparklesIcon />
                        </EmptyMedia>
                        <EmptyTitle>欢迎来到 AgentHub</EmptyTitle>
                        <EmptyDescription>
                            让多个智能体在同一个工作区里协同推进任务。
                        </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                        <Button
                            className="pointer-events-auto"
                            onClick={onCreateConversation}
                            type="button"
                        >
                            <MessageSquarePlusIcon data-icon="inline-start" />
                            新建会话
                        </Button>
                    </EmptyContent>
                </Empty>
            </div>
        </div>
    );
}
