"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  content: string;
  children: React.ReactNode;
}

export function Tooltip({ content, children, className, ...props }: TooltipProps) {
  return (
    <div className={cn("group relative inline-block", className)} {...props}>
      {children}
      <span className="invisible absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:visible">
        {content}
      </span>
    </div>
  );
}
