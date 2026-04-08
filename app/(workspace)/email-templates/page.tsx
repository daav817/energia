"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  EmailTemplatesEditor,
  type EmailTemplatesEditorHandle,
} from "@/components/email-templates/email-templates-editor";
export default function EmailTemplatesPage() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [saveNotice, setSaveNotice] = useState(false);
  const editorRef = useRef<EmailTemplatesEditorHandle>(null);

  useEffect(() => {
    if (!saveNotice) return;
    const t = window.setTimeout(() => setSaveNotice(false), 5000);
    return () => window.clearTimeout(t);
  }, [saveNotice]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) router.push("/inbox");
      }}
    >
      <DialogContent className="flex h-[min(92vh,920px)] max-h-[92vh] w-[min(96vw,1400px)] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]">
        <DialogHeader className="shrink-0 space-y-2 border-b px-6 py-4 pr-14 text-left sm:pr-16">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <DialogTitle>Email templates</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Stored in this browser only. Close this window when you are done (X or outside click).
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:mr-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => editorRef.current?.resetEdit()}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => editorRef.current?.save()}
              >
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
            </div>
          </div>
        </DialogHeader>
        {saveNotice ? (
          <div
            className="shrink-0 border-b border-emerald-500/25 bg-emerald-600/15 px-6 py-2.5 text-sm text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-100"
            aria-live="polite"
          >
            Templates saved to this browser.
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
          <EmailTemplatesEditor
            className="min-h-0 flex-1"
            ref={editorRef}
            onSaved={() => setSaveNotice(true)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
