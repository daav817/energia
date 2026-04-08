"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Plus, Trash2 } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/communications/RichTextEditor";
import {
  EMAIL_TEMPLATE_PLACEHOLDER_TREE,
  type TemplatePlaceholderNode,
} from "@/lib/email-template-placeholders";
import { loadEmailTemplates, type StoredEmailTemplate, saveEmailTemplates } from "@/lib/email-templates";
import {
  applyTemplateTokens,
  EMAIL_TEMPLATE_SAMPLE_VARIABLES,
} from "@/lib/renewal-email-template-merge";
import { cn } from "@/lib/utils";

function newTemplate(): StoredEmailTemplate {
  return {
    id: crypto.randomUUID(),
    name: "New template",
    subject: "",
    htmlBody: "<p></p>",
    updatedAt: new Date().toISOString(),
  };
}

const splitResizeHandleClass =
  "relative w-1.5 mx-0.5 shrink-0 rounded-sm bg-border/80 hover:bg-primary/40 outline-none";

function PlaceholderTree({
  nodes,
  depth,
  openGroups,
  toggleGroup,
  onPickField,
}: {
  nodes: TemplatePlaceholderNode[];
  depth: number;
  openGroups: Record<string, boolean>;
  toggleGroup: (id: string) => void;
  onPickField: (token: string) => void;
}) {
  return (
    <ul className={cn("space-y-0.5", depth > 0 && "mt-1 border-l border-border/60 pl-2 ml-2")}>
      {nodes.map((node) => {
        if (node.kind === "group") {
          const open = !!openGroups[node.id];
          return (
            <li key={node.id}>
              <button
                type="button"
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/80"
                onClick={() => toggleGroup(node.id)}
                aria-expanded={open}
              >
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="font-medium">{node.label}</span>
              </button>
              {open ? (
                <PlaceholderTree
                  nodes={node.children}
                  depth={depth + 1}
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  onPickField={onPickField}
                />
              ) : null}
            </li>
          );
        }
        return (
          <li key={node.id}>
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left text-xs text-primary hover:bg-muted/80 hover:underline"
              title={node.description ?? node.token}
              onClick={() => onPickField(node.token)}
            >
              {node.label}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{node.token}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type EmailTemplatesEditorProps = {
  className?: string;
  /** Called after templates are written to storage and state is refreshed. */
  onSaved?: () => void;
};

export type EmailTemplatesEditorHandle = {
  save: () => void;
  resetEdit: () => void;
};

export const EmailTemplatesEditor = forwardRef<EmailTemplatesEditorHandle, EmailTemplatesEditorProps>(
  function EmailTemplatesEditor(props, ref) {
    const { onSaved, className } = props;
  const [templates, setTemplates] = useState<StoredEmailTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listRevision, setListRevision] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [placeholderTarget, setPlaceholderTarget] = useState<"subject" | "body">("body");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    customer: true,
    mainContact: true,
    contract: true,
  });
  const [bodyInsert, setBodyInsert] = useState<{ nonce: number; html: string } | null>(null);

  useEffect(() => {
    const list = loadEmailTemplates();
    setTemplates(list);
    setSelectedId((prev) => (prev && list.some((t) => t.id === prev) ? prev : null));
    setHydrated(true);
  }, []);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) setPreviewOpen(false);
  }, [selected]);

  const previewMerged = useMemo(() => {
    if (!selected) return { subject: "", html: "" };
    return {
      subject: applyTemplateTokens(selected.subject ?? "", EMAIL_TEMPLATE_SAMPLE_VARIABLES),
      html: applyTemplateTokens(selected.htmlBody ?? "", EMAIL_TEMPLATE_SAMPLE_VARIABLES),
    };
  }, [selected]);

  const persist = useCallback((updater: (prev: StoredEmailTemplate[]) => StoredEmailTemplate[]) => {
    setTemplates((prev) => {
      const next = updater(prev);
      saveEmailTemplates(next);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((o) => ({ ...o, [id]: !o[id] }));
  }, []);

  const handlePickField = useCallback(
    (token: string) => {
      const raw = token.replace(/^\{\{|\}\}$/g, "");
      const piece = `{{${raw}}}`;

      if (placeholderTarget === "subject") {
        if (!selectedId) return;
        persist((prev) =>
          prev.map((t) =>
            t.id === selectedId
              ? { ...t, subject: (t.subject || "") + piece, updatedAt: new Date().toISOString() }
              : t
          )
        );
        return;
      }

      setBodyInsert({ nonce: Date.now(), html: piece });
    },
    [placeholderTarget, selectedId, persist]
  );

  const handleResetEdit = useCallback(() => {
    setSelectedId(null);
    setListRevision((n) => n + 1);
    setBodyInsert(null);
    setPlaceholderTarget("body");
    setOpenGroups({
      customer: true,
      mainContact: true,
      contract: true,
    });
  }, []);

  const handleSave = useCallback(() => {
    setTemplates((prev) => {
      saveEmailTemplates(prev);
      return prev;
    });
    const fresh = loadEmailTemplates();
    setTemplates(fresh);
    setSelectedId((prev) => (prev && fresh.some((t) => t.id === prev) ? prev : null));
    setListRevision((n) => n + 1);
    setBodyInsert(null);
    onSaved?.();
  }, [onSaved]);

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
      resetEdit: handleResetEdit,
    }),
    [handleSave, handleResetEdit]
  );

  if (!hydrated) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className={cn("flex min-h-0 w-full flex-col gap-4", className)}>
      <p className="shrink-0 text-sm text-muted-foreground">
        Format the message body with the editor; placeholders insert Energia field tokens. Nothing is selected until you
        pick a saved template or create a new one. Use the <strong className="font-medium text-foreground">Reset</strong> /{" "}
        <strong className="font-medium text-foreground">Save</strong> actions in the dialog header when this editor is
        opened from Settings.
      </p>

      <PanelGroup
        direction="horizontal"
        autoSaveId="energia-email-templates-split"
        className="min-h-0 min-w-0 flex-1 gap-0"
      >
        <Panel defaultSize={26} minSize={18} className="min-h-0 min-w-0">
          <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60">
            <CardHeader className="shrink-0 pb-2">
              <CardTitle className="text-base">Saved templates</CardTitle>
              <CardDescription>Select a template to edit or delete.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <Button
                type="button"
                size="sm"
                className="w-full shrink-0"
                variant="secondary"
                onClick={() => {
                  const t = newTemplate();
                  persist((prev) => [...prev, t]);
                  setSelectedId(t.id);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                New template
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-full shrink-0"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  if (!window.confirm("Delete this template?")) return;
                  const id = selected.id;
                  const next = templates.filter((t) => t.id !== id);
                  saveEmailTemplates(next);
                  setTemplates(next);
                  setSelectedId(null);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete template
              </Button>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/50 p-1">
                {templates.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No templates yet. Add one above.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {templates.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className={cn(
                            "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                            t.id === selectedId
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          )}
                          onClick={() => setSelectedId(t.id)}
                        >
                          <span className="block truncate font-medium">{t.name || "Untitled"}</span>
                          <span className="block truncate text-[10px] opacity-80">
                            Updated {new Date(t.updatedAt).toLocaleString()}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </Panel>
        <PanelResizeHandle className={splitResizeHandleClass} />
        <Panel defaultSize={74} minSize={38} className="min-h-0 min-w-0">
          <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60">
            <CardHeader className="shrink-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle>Edit template</CardTitle>
                  <CardDescription>
                    Placeholders use double curly braces and are filled when sending renewal or merge mail from Energia.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={!selected}
                  onClick={() => setPreviewOpen(true)}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview sample
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-6">
              {selected ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="tpl-name">Name</Label>
                    <Input
                      id="tpl-name"
                      value={selected.name}
                      onChange={(e) => {
                        const v = e.target.value;
                        const id = selected.id;
                        persist((prev) => prev.map((t) => (t.id === id ? { ...t, name: v } : t)));
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="tpl-subject">Subject</Label>
                    <Input
                      id="tpl-subject"
                      value={selected.subject}
                      onChange={(e) => {
                        const v = e.target.value;
                        const id = selected.id;
                        persist((prev) => prev.map((t) => (t.id === id ? { ...t, subject: v } : t)));
                      }}
                    />
                  </div>
                  <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
                    <div className="flex min-h-[220px] flex-col gap-2">
                      <Label>Message body</Label>
                      <div className="min-h-[200px] flex-1">
                        <RichTextEditor
                          initialHtml={selected.htmlBody}
                          resetKey={`${selected.id}-${listRevision}`}
                          onChangeHtml={(html) => {
                            const id = selected.id;
                            persist((prev) =>
                              prev.map((t) =>
                                t.id === id
                                  ? { ...t, htmlBody: html, updatedAt: new Date().toISOString() }
                                  : t
                              )
                            );
                          }}
                          insertSnippet={bodyInsert}
                        />
                      </div>
                    </div>
                    <div className="flex min-h-0 flex-col gap-2">
                      <Label>Placeholders</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Open a group, then click a field. Choose whether to append to the subject line or insert into the
                        body at the cursor.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={placeholderTarget === "subject" ? "default" : "outline"}
                          className="h-8 text-xs"
                          onClick={() => setPlaceholderTarget("subject")}
                        >
                          Insert → Subject
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={placeholderTarget === "body" ? "default" : "outline"}
                          className="h-8 text-xs"
                          onClick={() => setPlaceholderTarget("body")}
                        >
                          Insert → Body
                        </Button>
                      </div>
                      <div className="min-h-[160px] flex-1 overflow-y-auto rounded-md border bg-muted/20 p-2 xl:max-h-none">
                        <PlaceholderTree
                          nodes={EMAIL_TEMPLATE_PLACEHOLDER_TREE}
                          depth={0}
                          openGroups={openGroups}
                          toggleGroup={toggleGroup}
                          onPickField={handlePickField}
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a saved template from the list or click <span className="font-medium">New template</span> to
                  start editing.
                </p>
              )}
            </CardContent>
          </Card>
        </Panel>
      </PanelGroup>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[min(90vh,720px)] max-w-3xl overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Preview with sample data</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Placeholders are replaced with example values (not your live customers or contracts). Unknown tokens stay as{" "}
              <code className="text-xs">{"{{token}}"}</code>.
            </p>
          </DialogHeader>
          {selected ? (
            <div className="max-h-[min(65vh,560px)] space-y-4 overflow-y-auto pr-1">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</p>
                <p className="mt-1 text-sm font-medium">{previewMerged.subject || "(Empty subject)"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Body</p>
                <div
                  className="prose prose-sm dark:prose-invert mt-2 max-w-none rounded-md border bg-muted/30 p-4"
                  dangerouslySetInnerHTML={{ __html: previewMerged.html || "<p></p>" }}
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
  }
);
