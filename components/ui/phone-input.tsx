"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatUsPhoneDigits, usPhoneNeedsAttention } from "@/lib/us-phone";

export type PhoneInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange" | "onPaste"
> & {
  value: string;
  onChange: (value: string) => void;
  /** When false, only the highlighted border indicates attention (no helper line). Default true. */
  showFieldHint?: boolean;
};

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, className, showFieldHint = true, placeholder = "555-123-4567", ...props },
  ref
) {
  const attention = usPhoneNeedsAttention(value);

  return (
    <div className="w-full space-y-1">
      <Input
        ref={ref}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={value}
        onChange={(e) => onChange(formatUsPhoneDigits(e.target.value))}
        onPaste={(e) => {
          e.preventDefault();
          onChange(formatUsPhoneDigits(e.clipboardData.getData("text")));
        }}
        placeholder={placeholder}
        className={cn(
          attention && "border-amber-600 focus-visible:ring-amber-600 dark:border-amber-500",
          className
        )}
        aria-invalid={attention || undefined}
        {...props}
      />
      {showFieldHint && attention ? (
        <p className="text-xs text-amber-800 dark:text-amber-400">Enter a 10-digit US number as ###-###-####.</p>
      ) : null}
    </div>
  );
});
