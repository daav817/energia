"use client";

import { useEffect, useState } from "react";
import { Star, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RfpQuote = {
  id: string;
  rate: number;
  priceUnit: string;
  termMonths: number;
  brokerMargin: number | null;
  totalMargin: number | null;
  isBestOffer: boolean;
  supplier: { name: string };
  rfpRequest?: { customer?: { name: string } };
};

export default function RfpQuotesPage() {
  const [quotes, setQuotes] = useState<RfpQuote[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    supplierId: "",
    rate: "",
    priceUnit: "MCF",
    termMonths: "",
    brokerMargin: "",
    totalMargin: "",
    isBestOffer: false,
    notes: "",
  });

  useEffect(() => {
    fetchQuotes();
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((data) => setSuppliers(Array.isArray(data) ? data : []));
  }, []);

  const fetchQuotes = async () => {
    setLoading(true);
    const res = await fetch("/api/rfp/quotes");
    const data = await res.json();
    setQuotes(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const handleSetBest = async (id: string) => {
    await fetch(`/api/rfp/quotes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBestOffer: true }),
    });
    fetchQuotes();
  };

  const handleAddQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/rfp/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: form.supplierId,
        rate: parseFloat(form.rate),
        priceUnit: form.priceUnit,
        termMonths: parseInt(form.termMonths, 10),
        brokerMargin: form.brokerMargin ? parseFloat(form.brokerMargin) : undefined,
        totalMargin: form.totalMargin ? parseFloat(form.totalMargin) : undefined,
        isBestOffer: form.isBestOffer,
        notes: form.notes || undefined,
      }),
    });
    if (res.ok) {
      setDialogOpen(false);
      setForm({ supplierId: "", rate: "", priceUnit: "MCF", termMonths: "", brokerMargin: "", totalMargin: "", isBestOffer: false, notes: "" });
      fetchQuotes();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">RFP Quotes</h1>
          <p className="text-muted-foreground">
            Compare supplier quotes. Mark the best offer for each RFP.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Quote
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pricing Table</CardTitle>
          <CardDescription>
            Quotes from suppliers. Click the star to mark the best offer for a given term.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading...</p>
          ) : quotes.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No quotes yet. Add quotes from supplier RFP responses.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Broker Margin</TableHead>
                  <TableHead>Total Margin</TableHead>
                  <TableHead>Best</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id} className={q.isBestOffer ? "bg-primary/5" : ""}>
                    <TableCell className="font-medium">{q.supplier.name}</TableCell>
                    <TableCell>${Number(q.rate).toFixed(4)}</TableCell>
                    <TableCell>{q.priceUnit}</TableCell>
                    <TableCell>{q.termMonths} mo</TableCell>
                    <TableCell>
                      {q.brokerMargin != null ? `$${Number(q.brokerMargin).toFixed(4)}` : "—"}
                    </TableCell>
                    <TableCell>
                      {q.totalMargin != null ? `$${Number(q.totalMargin).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSetBest(q.id)}
                        className={q.isBestOffer ? "text-amber-500" : ""}
                      >
                        <Star className={q.isBestOffer ? "fill-current" : ""} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add RFP Quote</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddQuote} className="space-y-4">
            <div className="grid gap-2">
              <Label>Supplier *</Label>
              <Select value={form.supplierId} onValueChange={(v) => setForm({ ...form, supplierId: v })} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Rate *</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Unit *</Label>
                <Select value={form.priceUnit} onValueChange={(v) => setForm({ ...form, priceUnit: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KWH">KWH</SelectItem>
                    <SelectItem value="MCF">MCF</SelectItem>
                    <SelectItem value="CCF">CCF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Term (months) *</Label>
              <Input
                type="number"
                value={form.termMonths}
                onChange={(e) => setForm({ ...form, termMonths: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Broker Margin</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.brokerMargin}
                  onChange={(e) => setForm({ ...form, brokerMargin: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Total Margin</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.totalMargin}
                  onChange={(e) => setForm({ ...form, totalMargin: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isBestOffer}
                onChange={(e) => setForm({ ...form, isBestOffer: e.target.checked })}
              />
              <span className="text-sm">Best offer</span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
