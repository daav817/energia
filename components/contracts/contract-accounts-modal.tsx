"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2 } from "lucide-react";

export type ContractAccountRowDraft = {
  localKey: string;
  accountId: string;
  ldcUtility: string;
  serviceAddress: string;
  annualUsage: string;
  avgMonthlyUsage: string;
};

function emptyRow(): ContractAccountRowDraft {
  return {
    localKey: crypto.randomUUID(),
    accountId: "",
    ldcUtility: "",
    serviceAddress: "",
    annualUsage: "",
    avgMonthlyUsage: "",
  };
}

function parseUsageInput(raw: string): number | null {
  const n = parseFloat(String(raw).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function sumColumn(rows: ContractAccountRowDraft[], field: "annualUsage" | "avgMonthlyUsage"): number {
  let sum = 0;
  for (const r of rows) {
    const v = parseUsageInput(r[field]);
    if (v != null) sum += v;
  }
  return sum;
}

function formatUsageTotal(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10000) / 10000;
  if (Number.isInteger(rounded)) return rounded.toLocaleString();
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function energyLabel(et: "ELECTRIC" | "NATURAL_GAS" | null | undefined): string {
  if (et === "NATURAL_GAS") return "natural gas";
  if (et === "ELECTRIC") return "electric";
  return "this contract’s energy type";
}

export function ContractAccountsModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string | null;
  subtitle?: string;
  /** Used to filter utility suggestions and label the field. */
  contractEnergyType?: "ELECTRIC" | "NATURAL_GAS" | null;
  /** Distinct LDC / utility names from other contracts with the same energy type (and this contract). */
  utilityOptions?: string[];
  onSaved?: () => void;
}) {
  const {
    open,
    onOpenChange,
    contractId,
    subtitle,
    contractEnergyType,
    utilityOptions = [],
    onSaved,
  } = props;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ContractAccountRowDraft[]>([emptyRow()]);

  const utilityDatalistId = useMemo(
    () => (contractId ? `contract-acc-util-${contractId.replace(/[^a-zA-Z0-9_-]/g, "")}` : "contract-acc-util"),
    [contractId]
  );

  const hydrate = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/accounts`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to load");
      const list = Array.isArray(data) ? data : [];
      if (list.length === 0) {
        setRows([emptyRow()]);
      } else {
        setRows(
          list.map(
            (r: {
              accountId: string;
              ldcUtility?: string | null;
              serviceAddress?: string | null;
              annualUsage?: string | null;
              avgMonthlyUsage?: string | null;
            }) => ({
              localKey: crypto.randomUUID(),
              accountId: r.accountId ?? "",
              ldcUtility: r.ldcUtility ?? "",
              serviceAddress: r.serviceAddress ?? "",
              annualUsage: r.annualUsage ?? "",
              avgMonthlyUsage: r.avgMonthlyUsage ?? "",
            })
          )
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRows([emptyRow()]);
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    if (open && contractId) void hydrate();
  }, [open, contractId, hydrate]);

  const annualTotal = useMemo(() => sumColumn(rows, "annualUsage"), [rows]);
  const avgMonthlyTotal = useMemo(() => sumColumn(rows, "avgMonthlyUsage"), [rows]);

  const handleSave = async () => {
    if (!contractId) return;
    const payload = rows
      .map((r) => ({
        accountId: r.accountId.trim(),
        ldcUtility: r.ldcUtility.trim() || null,
        serviceAddress: r.serviceAddress.trim() || null,
        annualUsage: r.annualUsage.trim() || null,
        avgMonthlyUsage: r.avgMonthlyUsage.trim() || null,
      }))
      .filter((r) => r.accountId.length > 0);

    if (
      payload.length === 0 &&
      rows.some(
        (r) =>
          r.ldcUtility.trim() ||
          r.serviceAddress.trim() ||
          r.annualUsage.trim() ||
          r.avgMonthlyUsage.trim()
      )
    ) {
      setError("Enter an account ID for each row with usage or address data.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/accounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,1150px)] max-w-[min(96vw,1150px)] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contract utility accounts</DialogTitle>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          These values are used in renewal emails and other communications. Add one row per utility account.
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/90">Utility</span> is the LDC / delivery company for this account,
          scoped to {energyLabel(contractEnergyType)} contracts in your directory. Choose a suggestion or type a name.
        </p>
        {utilityOptions.length > 0 ? (
          <datalist id={utilityDatalistId}>
            {utilityOptions.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading…
          </p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: "19%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "38%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "2.25rem" }} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-2 font-medium min-w-[9.5rem]">Account ID</th>
                  <th className="p-2 font-medium">Utility</th>
                  <th className="p-2 font-medium">Service address</th>
                  <th className="p-2 pr-3 font-medium text-right">Annual usage</th>
                  <th className="p-2 pr-3 font-medium text-right">Avg monthly usage</th>
                  <th className="w-8 max-w-8 p-1 text-right">
                    <span className="sr-only">Remove row</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.localKey} className="border-b align-top">
                    <td className="p-1.5 min-w-0 align-top">
                      <Label className="sr-only">Account ID row {i + 1}</Label>
                      <Input
                        className="h-8 min-w-0 font-mono text-xs"
                        value={r.accountId}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) => (x.localKey === r.localKey ? { ...x, accountId: e.target.value } : x))
                          )
                        }
                        placeholder="Required"
                      />
                    </td>
                    <td className="p-1.5 min-w-0 align-top">
                      <Label className="sr-only">Utility row {i + 1}</Label>
                      <Input
                        className="h-8 min-w-0 w-full text-xs"
                        value={r.ldcUtility}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.localKey === r.localKey ? { ...x, ldcUtility: e.target.value } : x
                            )
                          )
                        }
                        placeholder="Optional"
                        list={utilityOptions.length > 0 ? utilityDatalistId : undefined}
                        autoComplete="off"
                      />
                    </td>
                    <td className="p-1.5 min-w-0 align-top">
                      <Label className="sr-only">Service address row {i + 1}</Label>
                      <Input
                        className="h-8 min-w-0 w-full text-xs"
                        value={r.serviceAddress}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.localKey === r.localKey ? { ...x, serviceAddress: e.target.value } : x
                            )
                          )
                        }
                        placeholder="Optional"
                      />
                    </td>
                    <td className="p-1.5 min-w-0 align-top text-right">
                      <Label className="sr-only">Annual usage row {i + 1}</Label>
                      <Input
                        className="h-8 min-w-0 text-right text-xs tabular-nums"
                        value={r.annualUsage}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.localKey === r.localKey ? { ...x, annualUsage: e.target.value } : x
                            )
                          )
                        }
                        placeholder="e.g. 1,234.5"
                        inputMode="text"
                        autoComplete="off"
                      />
                    </td>
                    <td className="p-1.5 min-w-0 align-top text-right">
                      <Label className="sr-only">Avg monthly usage row {i + 1}</Label>
                      <Input
                        className="h-8 min-w-0 text-right text-xs tabular-nums"
                        value={r.avgMonthlyUsage}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.localKey === r.localKey ? { ...x, avgMonthlyUsage: e.target.value } : x
                            )
                          )
                        }
                        placeholder="e.g. 1,234.5"
                        inputMode="text"
                        autoComplete="off"
                      />
                    </td>
                    <td className="w-8 max-w-8 p-0.5 pl-0 text-right align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground"
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() =>
                          setRows((prev) => {
                            const next = prev.filter((x) => x.localKey !== r.localKey);
                            return next.length === 0 ? [emptyRow()] : next;
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-medium">
                  <td className="p-2 text-muted-foreground" colSpan={3}>
                    Total
                  </td>
                  <td className="p-2 pr-3 text-right tabular-nums">{formatUsageTotal(annualTotal)}</td>
                  <td className="p-2 pr-3 text-right tabular-nums">{formatUsageTotal(avgMonthlyTotal)}</td>
                  <td className="w-8 max-w-8 p-0" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={loading}
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add account row
        </Button>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={loading || saving} onClick={() => void handleSave()}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
