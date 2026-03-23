"use client";

import { useEffect, useState } from "react";
import { FileText, Send, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Customer = { id: string; name: string; company: string | null };

export default function RfpGeneratorPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [energyType, setEnergyType] = useState<"ELECTRIC" | "NATURAL_GAS">("NATURAL_GAS");
  const [annualUsage, setAnnualUsage] = useState("");
  const [avgMonthlyUsage, setAvgMonthlyUsage] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [billUrl, setBillUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; sentTo?: number; error?: string } | null>(null);

  // Margin calculator (own usage fields: enter either avg monthly or annual, never both)
  const [marginPerUnit, setMarginPerUnit] = useState("");
  const [marginCalcAvgMonthly, setMarginCalcAvgMonthly] = useState("");
  const [marginCalcAnnual, setMarginCalcAnnual] = useState("");
  const [totalMargin, setTotalMargin] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => setCustomers(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    const term = parseInt(termMonths, 10);
    const margin = parseFloat(marginPerUnit);
    if (isNaN(term) || isNaN(margin)) {
      setTotalMargin(null);
      return;
    }
    const avg = parseFloat(marginCalcAvgMonthly);
    const annual = parseFloat(marginCalcAnnual);
    if (!isNaN(avg) && avg >= 0) {
      setTotalMargin(avg * term * margin);
    } else if (!isNaN(annual) && annual >= 0) {
      setTotalMargin(annual * (term / 12) * margin);
    } else {
      setTotalMargin(null);
    }
  }, [marginCalcAvgMonthly, marginCalcAnnual, termMonths, marginPerUnit]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/rfp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          energyType,
          annualUsage: annualUsage ? parseFloat(annualUsage) : undefined,
          avgMonthlyUsage: avgMonthlyUsage ? parseFloat(avgMonthlyUsage) : undefined,
          termMonths: termMonths ? parseInt(termMonths, 10) : undefined,
          billUrl: billUrl || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setResult({ success: true, sentTo: data.sentTo });
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Failed to send" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">RFP Generator</h1>
        <p className="text-muted-foreground">
          Send Request for Pricing to all suppliers matching the energy type.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Create RFP
            </CardTitle>
            <CardDescription>
              Select customer and energy type. RFP will be sent to all matching suppliers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSend} className="space-y-4">
              <div className="grid gap-2">
                <Label>Customer *</Label>
                <Select value={customerId} onValueChange={setCustomerId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.company ? ` (${c.company})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Energy Type *</Label>
                <Select value={energyType} onValueChange={(v) => setEnergyType(v as "ELECTRIC" | "NATURAL_GAS")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ELECTRIC">Electric</SelectItem>
                    <SelectItem value="NATURAL_GAS">Natural Gas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="annual">Annual Usage</Label>
                  <Input
                    id="annual"
                    type="number"
                    placeholder="e.g. 120000"
                    value={annualUsage}
                    onChange={(e) => setAnnualUsage(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="avg">Avg Monthly Usage</Label>
                  <Input
                    id="avg"
                    type="number"
                    placeholder="e.g. 10000"
                    value={avgMonthlyUsage}
                    onChange={(e) => setAvgMonthlyUsage(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="term">Term (months)</Label>
                <Input
                  id="term"
                  type="number"
                  placeholder="e.g. 12"
                  value={termMonths}
                  onChange={(e) => setTermMonths(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bill">Bill / Document URL</Label>
                <Input
                  id="bill"
                  placeholder="https://drive.google.com/..."
                  value={billUrl}
                  onChange={(e) => setBillUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {result?.success && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                  RFP sent to {result.sentTo} supplier(s).
                </div>
              )}
              {result?.error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {result.error}
                </div>
              )}
              <Button type="submit" disabled={sending}>
                {sending ? "Sending..." : "Send RFP to Suppliers"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Broker Margin Calculator
            </CardTitle>
            <CardDescription>
              Estimate total brokerage margin over the contract life.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="margin">Margin per unit ($/KWH or $/MCF)</Label>
              <Input
                id="margin"
                type="number"
                step="0.0001"
                placeholder="e.g. 0.002"
                value={marginPerUnit}
                onChange={(e) => setMarginPerUnit(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Avg Monthly Usage</Label>
              <Input
                type="number"
                placeholder="Enter one: monthly or annual"
                value={marginCalcAvgMonthly}
                onChange={(e) => {
                  setMarginCalcAvgMonthly(e.target.value);
                  if (e.target.value.trim() !== "") setMarginCalcAnnual("");
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Annual Usage</Label>
              <Input
                type="number"
                placeholder="Enter one: monthly or annual"
                value={marginCalcAnnual}
                onChange={(e) => {
                  setMarginCalcAnnual(e.target.value);
                  if (e.target.value.trim() !== "") setMarginCalcAvgMonthly("");
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Term (months)</Label>
              <Input
                type="number"
                placeholder="Same as RFP form"
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
              />
            </div>
            <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
              <p className="text-sm text-muted-foreground">Total Brokerage Margin</p>
              <p className="text-2xl font-bold">
                {totalMargin !== null
                  ? `$${totalMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                  : "—"}
              </p>
              {totalMargin !== null && termMonths.trim() !== "" && parseInt(termMonths, 10) > 0 && (() => {
                const term = parseInt(termMonths, 10);
                const avgMonthly = totalMargin! / term;
                const avgYearly = totalMargin! * (12 / term);
                return (
                  <div className="pt-2 border-t border-border/50 space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Avg yearly: <span className="font-semibold text-foreground">${avgYearly.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Avg monthly: <span className="font-semibold text-foreground">${avgMonthly.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </p>
                  </div>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                = margin/unit × (avg monthly × term) or (annual × term ÷ 12)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rate Comparison Calculator</CardTitle>
          <CardDescription>
            Compare customer&apos;s current rate and annual usage to new supplier quotes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RateComparisonCalculator />
        </CardContent>
      </Card>
    </div>
  );
}

function RateComparisonCalculator() {
  const [currentRate, setCurrentRate] = useState("");
  const [newRate, setNewRate] = useState("");
  const [annualUsage, setAnnualUsage] = useState("");
  const [savings, setSavings] = useState<number | null>(null);
  const [savingsPercent, setSavingsPercent] = useState<number | null>(null);

  useEffect(() => {
    const curr = parseFloat(currentRate);
    const n = parseFloat(newRate);
    const usage = parseFloat(annualUsage);
    if (!isNaN(curr) && !isNaN(n) && !isNaN(usage)) {
      const currentCost = curr * usage;
      const newCost = n * usage;
      setSavings(currentCost - newCost);
      setSavingsPercent(currentCost > 0 ? ((currentCost - newCost) / currentCost) * 100 : null);
    } else {
      setSavings(null);
      setSavingsPercent(null);
    }
  }, [currentRate, newRate, annualUsage]);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="grid gap-2">
        <Label>Current Rate ($/unit)</Label>
        <Input
          type="number"
          step="0.0001"
          placeholder="e.g. 0.08"
          value={currentRate}
          onChange={(e) => setCurrentRate(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label>New Rate ($/unit)</Label>
        <Input
          type="number"
          step="0.0001"
          placeholder="e.g. 0.065"
          value={newRate}
          onChange={(e) => setNewRate(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label>Annual Usage (units)</Label>
        <Input
          type="number"
          placeholder="e.g. 120000"
          value={annualUsage}
          onChange={(e) => setAnnualUsage(e.target.value)}
        />
      </div>
      <div className="sm:col-span-3 rounded-lg border bg-muted/50 p-4">
        <p className="text-sm text-muted-foreground">Annual Savings</p>
        <p className="text-2xl font-bold">
          {savings !== null
            ? `$${savings.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            : "—"}
        </p>
        {savingsPercent !== null && savings !== null && (
          <p className="text-sm text-muted-foreground">
            {savingsPercent >= 0 ? savingsPercent.toFixed(1) : (-savingsPercent).toFixed(1)}%
            {savings >= 0 ? " savings" : " increase"}
          </p>
        )}
      </div>
    </div>
  );
}
