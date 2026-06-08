"use client";

import type { HTMLAttributes } from "react";
import { useCallback, useState } from "react";

import { Blocks } from "@/components/animate-ui/icons/blocks";
import { cn } from "@/lib/utils";

type BlocksNavIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

function BlocksNavIcon({
  className,
  onMouseEnter,
  onMouseLeave,
  size = 28,
  ...props
}: BlocksNavIconProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setIsHovered(true);
      onMouseEnter?.(event);
    },
    [onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setIsHovered(false);
      onMouseLeave?.(event);
    },
    [onMouseLeave]
  );

  return (
    <div
      className={cn("inline-flex items-center justify-center", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <Blocks animate={isHovered} completeOnStop size={size} />
    </div>
  );
}

BlocksNavIcon.displayName = "BlocksNavIcon";

export { BlocksNavIcon };
