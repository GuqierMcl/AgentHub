"use client";

import type { HTMLAttributes } from "react";
import { useCallback, useState } from "react";

import { RefreshCw } from "@/components/animate-ui/icons/refresh-cw";
import { cn } from "@/lib/utils";

type AnimatedRefreshCwIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
  spinning?: boolean;
};

function AnimatedRefreshCwIcon({
  className,
  onMouseEnter,
  onMouseLeave,
  size,
  spinning = false,
  ...props
}: AnimatedRefreshCwIconProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      setIsHovered(true);
      onMouseEnter?.(event);
    },
    [onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      setIsHovered(false);
      onMouseLeave?.(event);
    },
    [onMouseLeave]
  );

  const animation = spinning ? "rotate" : isHovered ? "default" : false;

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <RefreshCw
        animate={animation}
        completeOnStop
        loop={spinning}
        size={size}
      />
    </span>
  );
}

export { AnimatedRefreshCwIcon };
