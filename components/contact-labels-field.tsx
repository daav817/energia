"use client";

import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseContactLabels, formatContactLabels } from "@/lib/contact-labels";

type Props = {
  value: string;
  onChange: (serialized: string) => void;
  /** Known labels (e.g. from /api/contacts/label-options) plus optional Google suggestions */
  presetLabels: string[];
  description?: string;
  idPrefix?: string;
};

/**
 * Multi-label editor: checkboxes for known labels + custom add. Stored as comma-separated string.
 */
export function ContactLabelsField({
  value,
  onChange,
  presetLabels,
  description = "Select any that apply. Values are saved comma-separated, same as the Contacts page.",
  idPrefix = "cl",
}: Props) {
  const selected = useMemo(() => parseContactLabels(value), [value]);
  const [custom, setCustom] = useState("");

  const allKnown = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...presetLabels, ...selected]) {
      const t = x.trim();
      if (!t) continue;
      m.set(t.toLowerCase(), t);
    }
    return Array.from(m.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [presetLabels, selected]);

  const toggle = (label: string) => {
    const L = label.trim();
    if (!L) return;
    const key = L.toLowerCase();
    const has = selected.some((s) => s.toLowerCase() === key);
    if (has) {
      onChange(formatContactLabels(selected.filter((s) => s.toLowerCase() !== key)));
    } else {
      onChange(formatContactLabels([...selected, L]));
    }
  };

  const addCustom = () => {
    const t = custom.trim();
    if (!t) return;
    if (!selected.some((s) => s.toLowerCase() === t.toLowerCase())) {
      onChange(formatContactLabels([...selected, t]));
    }
    setCustom("");
  };

  return (
    <div className="space-y-2">
      <Label>Labels</Label>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <div
        className="max-h-40 overflow-y-auto overscroll-contain rounded border p-2 space-y-2"
        onMouseDown={(e) => e.preventDefault()}
      >
        {allKnown.length === 0 ? (
          <p className="text-xs text-muted-foreground">No preset labels yet — add a custom label below.</p>
        ) : (
          allKnown.map((lb) => (
            <label key={lb} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-input accent-primary"
                checked={selected.some((s) => s.toLowerCase() === lb.toLowerCase())}
                onChange={() => toggle(lb)}
                id={`${idPrefix}-${lb}`}
              />
              <span>{lb}</span>
            </label>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Add another label"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={addCustom}>
          Add
        </Button>
      </div>
    </div>
  );
}
