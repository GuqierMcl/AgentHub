import {
  Tabs as AnimatedTabs,
  TabsList as AnimatedTabsList,
  TabsTrigger as AnimatedTabsTrigger,
  TabsContent as AnimatedTabsContent,
  TabsContents as AnimatedTabsContents,
  type TabsProps as AnimatedTabsProps,
  type TabsListProps as AnimatedTabsListProps,
  type TabsTriggerProps as AnimatedTabsTriggerProps,
  type TabsContentProps as AnimatedTabsContentProps,
  type TabsContentsProps as AnimatedTabsContentsProps,
} from "@/components/animate-ui/components/radix/tabs"
import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: AnimatedTabsProps) {
  return <AnimatedTabs className={cn(className)} {...props} />
}

function TabsList({
  className,
  variant = "default",
  ...props
}: AnimatedTabsListProps & { variant?: "default" | "line" }) {
  if (variant === "line") {
    return (
      <AnimatedTabsList
        className={cn("w-full", className)}
        {...props}
      />
    )
  }
  return (
    <AnimatedTabsList
      className={cn("w-full", className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: AnimatedTabsTriggerProps) {
  return <AnimatedTabsTrigger className={cn(className)} {...props} />
}

function TabsContents({ className, ...props }: AnimatedTabsContentsProps) {
  return <AnimatedTabsContents className={cn(className)} {...props} />
}

function TabsContent({ className, ...props }: AnimatedTabsContentProps) {
  return <AnimatedTabsContent className={cn(className)} {...props} />
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContents,
  TabsContent,
  type AnimatedTabsProps as TabsProps,
  type AnimatedTabsListProps as TabsListProps,
  type AnimatedTabsTriggerProps as TabsTriggerProps,
  type AnimatedTabsContentsProps as TabsContentsProps,
  type AnimatedTabsContentProps as TabsContentProps,
}
