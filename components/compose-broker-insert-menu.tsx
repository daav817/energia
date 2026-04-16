"use client";

import type { RefObject } from "react";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { brokerProfileFullInfoPlainText, loadBrokerProfile, type BrokerProfile } from "@/lib/broker-profile";

export function insertTextAtTextareaSelection(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  setValue: (next: string) => void,
  insertion: string
): void {
  const el = textareaRef.current;
  const start = el && typeof el.selectionStart === "number" ? el.selectionStart : value.length;
  const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : value.length;
  const next = value.slice(0, start) + insertion + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const pos = start + insertion.length;
    ta.setSelectionRange(pos, pos);
  });
}

export function ComposeBrokerInsertMenu(props: {
  disabled?: boolean;
  /** Plain text inserted from Settings → Profile (empty string if field blank). */
  onInsert: (text: string) => void;
  align?: "start" | "end" | "center";
  /** Merged onto the trigger button (e.g. compact height). */
  triggerClassName?: string;
}) {
  const { disabled, onInsert, align = "end", triggerClassName } = props;

  const insert = (pick: (p: BrokerProfile) => string) => {
    const p = loadBrokerProfile();
    onInsert(pick(p) ?? "");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("shrink-0", triggerClassName)}
          disabled={disabled}
        >
          <User className="mr-2 h-4 w-4 shrink-0" />
          Insert broker
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">From Settings → Profile. Inserts at the cursor.</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onInsert(brokerProfileFullInfoPlainText(loadBrokerProfile()))}
          className="cursor-pointer font-medium"
        >
          Full info (name, company, phone, fax, email)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => insert((p) => p.firstName)} className="cursor-pointer">
          First name
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => insert((p) => p.lastName)} className="cursor-pointer">
          Last name
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => insert((p) => p.companyName)} className="cursor-pointer">
          Company name
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => insert((p) => p.email)} className="cursor-pointer">
          Email
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => insert((p) => p.phone)} className="cursor-pointer">
          Phone
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => insert((p) => p.fax)} className="cursor-pointer">
          Fax
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
