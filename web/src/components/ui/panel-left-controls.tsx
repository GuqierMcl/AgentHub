"use client";

import type { HTMLAttributes } from "react";
import { useCallback, useState } from "react";

import { PanelLeftClose } from "@/components/animate-ui/icons/panel-left-close";
import { PanelLeftOpen } from "@/components/animate-ui/icons/panel-left-open";
import { cn } from "@/lib/utils";

type AnimatedPanelLeftIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

function AnimatedPanelLeftOpenIcon({
  className,
  onMouseEnter,
  onMouseLeave,
  size,
  ...props
}: AnimatedPanelLeftIconProps) {
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

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <PanelLeftOpen animate={isHovered} completeOnStop size={size} />
    </span>
  );
}

function AnimatedPanelLeftCloseIcon({
  className,
  onMouseEnter,
  onMouseLeave,
  size,
  ...props
}: AnimatedPanelLeftIconProps) {
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

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <PanelLeftClose animate={isHovered} completeOnStop size={size} />
    </span>
  );
}

export { AnimatedPanelLeftOpenIcon, AnimatedPanelLeftCloseIcon };
