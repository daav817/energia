"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Label = { id: string; name: string };

const SYSTEM_IDS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD"];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emailIds: string[];
  labels: Label[];
  onSelect: (emailIds: string[], labelId: string) => void;
};

export function MoveToFolderDialog({
  open,
  onOpenChange,
  emailIds,
  labels,
  onSelect,
}: Props) {
  const [filter, setFilter] = useState("");
  const assignableLabels = useMemo(
    () => labels.filter((l) => !SYSTEM_IDS.includes(l.id)),
    [labels]
  );
  const filteredLabels = useMemo(
    () =>
      !filter.trim()
        ? assignableLabels
        : assignableLabels.filter((l) => {
            const name = l.name.replace(/^\[Gmail\]\/?/i, "").trim().toLowerCase();
            return name.includes(filter.trim().toLowerCase());
          }),
    [assignableLabels, filter]
  );

  const handleSelect = (labelId: string) => {
    onSelect(emailIds, labelId);
    setFilter("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[280px]">
        <DialogHeader>
          <DialogTitle>
            Move to folder{emailIds.length > 1 ? ` (${emailIds.length} emails)` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 w-full">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter folders..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9 w-full max-w-full"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-auto rounded-md border w-full max-w-full">
            {filteredLabels.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {assignableLabels.length === 0 ? "No folders available" : "No folders match your search"}
              </p>
            ) : (
              <div className="py-1">
                {filteredLabels.map((l) => (
                  <button
                    key={l.id}
                    className="flex w-full items-center px-4 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => handleSelect(l.id)}
                  >
                    <span className="truncate">{l.name.replace(/^\[Gmail\]\/?/i, "").trim() || l.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
