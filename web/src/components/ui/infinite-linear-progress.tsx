import * as React from "react"

import { cn } from "@/lib/utils"

function InfiniteLinearProgress({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-label="Loading"
      role="progressbar"
      className={cn(
        "relative h-1 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <div className="absolute inset-y-0 w-1/4 rounded-full bg-primary motion-reduce:hidden animate-indeterminate-fast" />
      <div className="absolute inset-y-0 w-1/3 rounded-full bg-primary/60 motion-reduce:hidden animate-indeterminate-slow" />
    </div>
  )
}

export { InfiniteLinearProgress }
