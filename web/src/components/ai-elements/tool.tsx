"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement, useMemo } from "react";

import { CodeBlock } from "./code-block";

const TOOL_DISPLAY_CODE_CHARS = 32_000;
const TOOL_DISPLAY_STRING_CHARS = 12_000;
const TOOL_DISPLAY_MAX_DEPTH = 6;
const TOOL_DISPLAY_MAX_ENTRIES = 120;

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  const code = useMemo(() => stringifyToolJson(input), [input]);

  return (
    <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Parameters
      </h4>
      <div className="rounded-md bg-muted/50">
        <CodeBlock code={code} language="json" />
      </div>
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  const hasOutput = output !== undefined && output !== null && output !== "";
  const outputCode = useMemo(() => {
    if (!hasOutput || isValidElement(output)) {
      return undefined;
    }
    if (typeof output === "object") {
      return stringifyToolJson(output);
    }
    if (typeof output === "string") {
      return truncateToolText(output, TOOL_DISPLAY_CODE_CHARS);
    }
    return undefined;
  }, [hasOutput, output]);

  if (!(hasOutput || errorText)) {
    return null;
  }

  let Output = hasOutput ? <div>{output as ReactNode}</div> : null;

  if (outputCode !== undefined) {
    Output = <CodeBlock code={outputCode} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};

function stringifyToolJson(value: unknown): string {
  try {
    const normalized = normalizeToolJsonValue(value, new WeakSet(), 0);
    return truncateToolText(
      JSON.stringify(normalized, null, 2),
      TOOL_DISPLAY_CODE_CHARS
    );
  } catch {
    return truncateToolText(String(value), TOOL_DISPLAY_CODE_CHARS);
  }
}

function normalizeToolJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (typeof value === "string") {
    return truncateToolText(value, TOOL_DISPLAY_STRING_CHARS);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (depth >= TOOL_DISPLAY_MAX_DEPTH) {
    return "[Max display depth reached]";
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .slice(0, TOOL_DISPLAY_MAX_ENTRIES)
      .map((item) => normalizeToolJsonValue(item, seen, depth + 1));
    if (value.length > TOOL_DISPLAY_MAX_ENTRIES) {
      result.push(
        `... ${value.length - TOOL_DISPLAY_MAX_ENTRIES} more items truncated for display`
      );
    }
    seen.delete(value);
    return result;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(0, TOOL_DISPLAY_MAX_ENTRIES)) {
    result[key] = normalizeToolJsonValue(entryValue, seen, depth + 1);
  }
  if (entries.length > TOOL_DISPLAY_MAX_ENTRIES) {
    result.__truncated__ =
      `${entries.length - TOOL_DISPLAY_MAX_ENTRIES} more properties truncated for display`;
  }
  seen.delete(value);
  return result;
}

function truncateToolText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n... [truncated ${value.length - maxChars} characters for display]`;
}
