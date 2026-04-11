"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Search, Link2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatUsPhoneDigits } from "@/lib/us-phone";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  isElectric: boolean;
  isNaturalGas: boolean;
  contactLinks?: { id: string; name: string; email: string | null; phone: string | null; isPriority: boolean }[];
};

type EnergyFilter = "all" | "electric" | "gas" | "both";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filter, setFilter] = useState<EnergyFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSupplier, setLinkSupplier] = useState<Supplier | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<
    { id: string; name: string; email: string | null; phone: string | null; company: string | null; label: string | null }[]
  >([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    notes: "",
    isElectric: false,
    isNaturalGas: false,
  });

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (search) params.set("search", search);
    params.set("contacts", "1");
    const res = await fetch(`/api/suppliers?${params}`);
    const data = await res.json();
    setSuppliers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  const handleSearch = () => fetchSuppliers();

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/directory/sync-entities", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Failed to sync");
      await fetchSuppliers();
      if (data?.autoLinked) {
        const { fromContracts, fromEmail, fromPhone } = data.autoLinked;
        alert(
          `Auto-link complete. Linked contacts: from contracts=${fromContracts}, from email=${fromEmail}, from phone=${fromPhone}`
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncing(false);
    }
  };

  const openLinkContact = async (s: Supplier) => {
    setLinkSupplier(s);
    setLinkError(null);
    const initial = (s.name || "").trim();
    setContactSearch(initial);
    setContactResults([]);
    setLinkOpen(true);
    if (!initial) return;
    try {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(initial)}&sort=name&order=asc`);
      const data = await res.json();
      setContactResults(Array.isArray(data?.contacts) ? data.contacts : []);
    } catch {
      setContactResults([]);
    }
  };

  const searchContacts = async () => {
    const term = contactSearch.trim();
    if (!term) {
      setContactResults([]);
      return;
    }
    const res = await fetch(`/api/contacts?search=${encodeURIComponent(term)}&sort=name&order=asc`);
    const data = await res.json();
    setContactResults(Array.isArray(data?.contacts) ? data.contacts : []);
  };

  const linkContactToSupplier = async (contactId: string) => {
    if (!linkSupplier) return;
    setLinking(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: linkSupplier.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Failed to link contact");
      setLinkOpen(false);
      setLinkSupplier(null);
      await fetchSuppliers();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Failed to link contact");
    } finally {
      setLinking(false);
    }
  };

  const getPrimaryContact = (s: Supplier) => {
    const links = s.contactLinks ?? [];
    const primary = links.find((c) => c.isPriority);
    return primary || links[0] || null;
  };
  const needsAttention = (s: Supplier) => {
    const pc = getPrimaryContact(s);
    if (!pc) return true;
    return !(pc.email || pc.phone);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      name: "",
      email: "",
      phone: "",
      website: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      notes: "",
      isElectric: false,
      isNaturalGas: false,
    });
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      email: s.email || "",
      phone: formatUsPhoneDigits(s.phone || ""),
      website: s.website || "",
      address: "",
      city: "",
      state: "",
      zip: "",
      notes: "",
      isElectric: s.isElectric,
      isNaturalGas: s.isNaturalGas,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingId ? `/api/suppliers/${editingId}` : "/api/suppliers";
    const method = editingId ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        email: form.email || null,
        phone: form.phone || null,
        website: form.website || null,
      }),
    });
    if (res.ok) {
      setDialogOpen(false);
      fetchSuppliers();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to save");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this supplier?")) return;
    const res = await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
    if (res.ok) fetchSuppliers();
    else alert("Failed to delete");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage supplier contacts. Filter by energy type.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="Derive supplier energy types from contracts">
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              Sync from contracts
            </Button>
          </Tooltip>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Supplier
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Suppliers</CardTitle>
          <CardDescription>
            Filter by Electric, Natural Gas, or Both. Search by name or email.
          </CardDescription>
          <div className="flex flex-col gap-4 pt-4 sm:flex-row">
            <Select value={filter} onValueChange={(v) => setFilter(v as EnergyFilter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by energy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="electric">Electric only</SelectItem>
                <SelectItem value="gas">Natural Gas only</SelectItem>
                <SelectItem value="both">Both Electric & Gas</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 flex-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name or email..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
              <Button variant="secondary" onClick={handleSearch}>
                Search
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading...</p>
          ) : suppliers.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No suppliers found. Add one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Primary Contact</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Energy Types</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {getPrimaryContact(s) ? (
                        <div className="text-sm">
                          <div className="font-medium">{getPrimaryContact(s)!.name}</div>
                          {getPrimaryContact(s)!.email && <div>{getPrimaryContact(s)!.email}</div>}
                          {getPrimaryContact(s)!.phone && (
                            <div className="text-muted-foreground">{getPrimaryContact(s)!.phone}</div>
                          )}
                          {!getPrimaryContact(s)!.email && !getPrimaryContact(s)!.phone && (
                            <div className="text-muted-foreground">No email/phone on linked contact</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">—</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.website ? (
                        <a
                          href={s.website.startsWith("http") ? s.website : `https://${s.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {s.website}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {s.isElectric && <Badge variant="electric">Electric</Badge>}
                        {s.isNaturalGas && <Badge variant="gas">Gas</Badge>}
                        {!s.isElectric && !s.isNaturalGas && (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {needsAttention(s) ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Needs attention
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Linked</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Tooltip content="Link a contact to this supplier">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openLinkContact(s)}
                            title="Link contact"
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(s)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(s.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link contact to supplier</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Supplier: <span className="font-medium text-foreground">{linkSupplier?.name || "—"}</span>
            </div>
            {linkError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {linkError}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search contacts by name, email, company..."
                onKeyDown={(e) => e.key === "Enter" && searchContacts()}
              />
              <Button variant="secondary" onClick={searchContacts}>
                Search
              </Button>
            </div>
            <div className="max-h-72 overflow-auto rounded-md border">
              {contactResults.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No matching contacts.</div>
              ) : (
                <div className="divide-y">
                  {contactResults.map((ct) => (
                    <button
                      key={ct.id}
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-muted transition-colors"
                      disabled={linking}
                      onClick={() => linkContactToSupplier(ct.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{ct.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {ct.email || "—"} {ct.phone ? `• ${ct.phone}` : ""} {ct.company ? `• ${ct.company}` : ""}
                          </div>
                          {ct.label && <div className="text-xs text-primary/80 truncate">{ct.label}</div>}
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">Click to link</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkOpen(false)} disabled={linking}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <PhoneInput id="phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                placeholder="https://..."
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isElectric}
                  onChange={(e) =>
                    setForm({ ...form, isElectric: e.target.checked })
                  }
                />
                <span className="text-sm">Electric</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isNaturalGas}
                  onChange={(e) =>
                    setForm({ ...form, isNaturalGas: e.target.checked })
                  }
                />
                <span className="text-sm">Natural Gas</span>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">{editingId ? "Save" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
