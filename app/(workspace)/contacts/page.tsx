"use client";

import { useEffect, useState, useCallback, useMemo, type FormEvent } from "react";
import {
  Users,
  Plus,
  Trash2,
  Pencil,
  Download,
  Calendar,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  RefreshCw,
  Settings,
  Star,
  X,
  StickyNote,
  Loader2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContactLabelsField } from "@/components/contact-labels-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ContactEmail = { id?: string; email: string; type?: string };
type ContactPhone = { id?: string; phone: string; type?: string };
type ContactAddress = { id?: string; street?: string; city?: string; state?: string; zip?: string; type?: string };
type SignificantDate = { id?: string; label: string; date: string };
type RelatedPerson = { id?: string; name: string; relation?: string };

type ComposeTarget = { recipients: Array<{ email: string; name?: string }> };

type Contact = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle?: string | null;
  label?: string | null;
  website?: string | null;
  notes: string | null;
  source: string;
  isPriority?: boolean;
  createdAt: string;
  updatedAt: string;
  emails?: ContactEmail[];
  phones?: ContactPhone[];
  addresses?: ContactAddress[];
  significantDates?: SignificantDate[];
  relatedPersons?: RelatedPerson[];
};

const AVAILABLE_COLUMNS = [
  { id: "name", label: "Name" },
  { id: "notes", label: "Notes (contact)" },
  { id: "company", label: "Company" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "jobTitle", label: "Job Title" },
  { id: "label", label: "Label" },
  { id: "recentInteractions", label: "Recent Interactions" },
  { id: "actions", label: "Actions" },
] as const;

/** Table column order: Label & Recent Interactions follow Phone for more phone width. */
const TABLE_COLUMN_ORDER = [
  "name",
  "notes",
  "company",
  "email",
  "phone",
  "jobTitle",
  "label",
  "recentInteractions",
  "actions",
] as const;

const COLUMNS_STORAGE_KEY = "energia-contacts-visible-columns";

function getDefaultVisibleColumns(): Set<string> {
  const defaults = new Set([
    "name",
    "notes",
    "company",
    "email",
    "phone",
    "label",
    "recentInteractions",
    "actions",
  ]);
  if (typeof window === "undefined") return defaults;
  try {
    const s = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (s) {
      const parsed = JSON.parse(s) as string[];
      if (Array.isArray(parsed)) {
        const next = new Set(parsed);
        if (!next.has("notes")) next.add("notes");
        return next;
      }
    }
  } catch {}
  return defaults;
}

type SyncPreview = {
  incomingFromGoogle: Array<{ name: string; email?: string; resourceName: string }>;
  outgoingToGoogle: Array<{ id: string; name: string; email?: string; change: string }>;
  conflicts: Array<{
    localId: string;
    googleResourceName: string;
    name: string;
    localChanges: string;
    googleChanges: string;
    diffFields: Array<{
      key: string;
      label: string;
      localValue: string;
      googleValue: string;
    }>;
  }>;
};

type SupplierLabelGap = {
  id: string;
  name: string;
  company: string | null;
  label: string | null;
  email: string | null;
  phone: string | null;
};

const emptyForm = {
  firstName: "",
  lastName: "",
  name: "",
  email: "",
  phone: "",
  company: "",
  jobTitle: "",
  label: "",
  website: "",
  notes: "",
  emails: [] as ContactEmail[],
  phones: [] as ContactPhone[],
  addresses: [] as ContactAddress[],
  significantDates: [] as SignificantDate[],
  relatedPersons: [] as RelatedPerson[],
};

const SEARCH_DEBOUNCE_MS = 350;

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortCol, setSortCol] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [syncChoices, setSyncChoices] = useState<{
    incoming: string[];
    outgoing: string[];
    conflicts: Record<string, Record<string, "local" | "google" | "skip">>;
  }>({ incoming: [], outgoing: [], conflicts: {} });
  const [recentEmails, setRecentEmails] = useState<Record<string, Array<{ id: string; subject: string; sentAt: string }>>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedConfirm, setDeleteSelectedConfirm] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => getDefaultVisibleColumns());
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);
  const [favorites, setFavorites] = useState<Contact[]>([]);
  const [needsGoogleSync, setNeedsGoogleSync] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [googleLabelOptions, setGoogleLabelOptions] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string>("__all__");
  const [distinctLabels, setDistinctLabels] = useState<string[]>([]);
  const [notesQuickOpen, setNotesQuickOpen] = useState(false);
  const [notesQuickContact, setNotesQuickContact] = useState<Contact | null>(null);
  const [notesQuickText, setNotesQuickText] = useState("");
  const [notesQuickSaving, setNotesQuickSaving] = useState(false);
  const [composeTarget, setComposeTarget] = useState<ComposeTarget | null>(null);
  const [supplierLabelGaps, setSupplierLabelGaps] = useState<SupplierLabelGap[]>([]);

  const googleContactsBusy = importing || syncPreviewLoading || syncing;

  const syncChangeCount = useMemo(() => {
    const incoming = syncPreview?.incomingFromGoogle?.length ?? 0;
    const outgoing = syncPreview?.outgoingToGoogle?.length ?? 0;
    const conflicts = syncPreview?.conflicts?.length ?? 0;
    return incoming + outgoing + conflicts;
  }, [syncPreview]);

  const refreshLabelOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts/label-options");
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.labels)) setDistinctLabels(data.labels);
    } catch {
      setDistinctLabels([]);
    }
  }, []);

  const refreshSupplierLabelGaps = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts/supplier-label-gaps");
      const data = await res.json();
      setSupplierLabelGaps(Array.isArray(data?.contacts) ? data.contacts : []);
    } catch {
      setSupplierLabelGaps([]);
    }
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (labelFilter && labelFilter !== "__all__") params.set("labelFilter", labelFilter);
      params.set("sort", sortCol);
      params.set("order", sortOrder);
      const res = await fetch("/api/contacts?" + params.toString());
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setContacts(data.contacts ?? data);
      setTotalCount(data.total ?? (data.contacts ?? data).length);
    } catch (err) {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, labelFilter, sortCol, sortOrder, refreshLabelOptions, refreshSupplierLabelGaps]);

  const refreshFavorites = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("priority", "true");
      const res = await fetch("/api/contacts?" + params.toString());
      const data = await res.json();
      setFavorites(data.contacts ?? data);
    } catch {
      setFavorites([]);
    }
  }, []);

  useEffect(() => {
    refreshFavorites();
  }, [refreshFavorites]);

  useEffect(() => {
    // Optional: enrich label input with Google Contacts label/group suggestions.
    (async () => {
      try {
        const res = await fetch("/api/contacts/google-groups");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data?.groups) ? data.groups : [];
        setGoogleLabelOptions(list.map((g: any) => String(g.displayName)).filter(Boolean));
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    void refreshLabelOptions();
    void refreshSupplierLabelGaps();
  }, [refreshLabelOptions, refreshSupplierLabelGaps]);

  useEffect(() => {
    if (contacts.length === 0) setNeedsGoogleSync(false);
  }, [contacts.length]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (contacts.length === 0) return;
    const ids = contacts.map((c) => c.id);
    let cancelled = false;
    void (async () => {
      await new Promise((r) => setTimeout(r, 80));
      try {
        const res = await fetch("/api/contacts/recent-emails-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        const byId = data.byId && typeof data.byId === "object" ? (data.byId as Record<string, unknown>) : {};
        setRecentEmails((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            const row = byId[id];
            if (Array.isArray(row)) next[id] = row as Array<{ id: string; subject: string; sentAt: string }>;
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contacts]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortOrder("asc");
    }
  };

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <button
      type="button"
      className="flex items-center gap-1 font-medium hover:underline"
      onClick={() => toggleSort(col)}
    >
      {label}
      {sortCol === col ? (
        sortOrder === "asc" ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )
      ) : null}
    </button>
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim() || [form.firstName, form.lastName].filter(Boolean).join(" ").trim();
    if (!name) return;
    try {
      const trimmedRows = form.emails
        .map((row) => ({ ...row, email: (row.email || "").trim() }))
        .filter((row) => row.email);
      const payload = {
        ...form,
        name,
        emails:
          trimmedRows.length > 0
            ? trimmedRows
            : form.email?.trim()
              ? [{ email: form.email.trim(), type: "work" }]
              : [],
        phones: form.phones.length ? form.phones : form.phone ? [{ phone: form.phone, type: "work" }] : [],
      };
      delete (payload as Record<string, unknown>).email;
      delete (payload as Record<string, unknown>).phone;
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCreateOpen(false);
      setForm(emptyForm);
      fetchContacts();
      refreshFavorites();
      void refreshLabelOptions();
      void refreshSupplierLabelGaps();
      setNeedsGoogleSync(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editContact) return;
    const name = form.name.trim() || [form.firstName, form.lastName].filter(Boolean).join(" ").trim();
    if (!name) return;
    try {
      const trimmedRows = form.emails
        .map((row) => ({ ...row, email: (row.email || "").trim() }))
        .filter((row) => row.email);
      const payload = {
        ...form,
        name,
        emails: trimmedRows,
        phones: form.phones.length ? form.phones : form.phone ? [{ phone: form.phone, type: "work" }] : [],
      };
      delete (payload as Record<string, unknown>).email;
      delete (payload as Record<string, unknown>).phone;
      const res = await fetch(`/api/contacts/${editContact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEditContact(null);
      setForm(emptyForm);
      fetchContacts();
      refreshFavorites();
      void refreshLabelOptions();
      void refreshSupplierLabelGaps();
      setNeedsGoogleSync(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!deleteContact) return;
    try {
      const res = await fetch(`/api/contacts/${deleteContact.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDeleteContact(null);
      fetchContacts();
      refreshFavorites();
      void refreshLabelOptions();
      void refreshSupplierLabelGaps();
      setNeedsGoogleSync(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch("/api/contacts/delete-multiple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDeleteSelectedConfirm(false);
      setSelectedIds(new Set());
      fetchContacts();
      refreshFavorites();
      setNeedsGoogleSync(false);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (contacts.length === 0) return;
    if (selectedIds.size >= contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  };

  const selectAllDisplayed = () => {
    if (contacts.length === 0) return;
    setSelectedIds(new Set(contacts.map((c) => c.id)));
  };

  const deselectAllContacts = () => setSelectedIds(new Set());

  const handleImportGoogle = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/contacts/import-google", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      fetchContacts();
      refreshFavorites();
      void refreshLabelOptions();
      void refreshSupplierLabelGaps();
      const extra = [
        data.skipped ? `${data.skipped} updated / already linked` : "",
        data.skippedNonBusiness ? `${data.skippedNonBusiness} skipped (non-business)` : "",
        data.skippedNoIdentity ? `${data.skippedNoIdentity} skipped (no name/email)` : "",
      ]
        .filter(Boolean)
        .join(". ");
      alert(`Imported ${data.imported} new contact(s). ${extra || "Done."}`);
      setNeedsGoogleSync(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const openSyncPreview = async () => {
    setSyncPreviewLoading(true);
    try {
      const res = await fetch("/api/contacts/sync-preview");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncPreview(data);
      setSyncChoices({
        incoming: data.incomingFromGoogle?.map((x: { resourceName: string }) => x.resourceName) || [],
        outgoing: data.outgoingToGoogle?.map((x: { id: string }) => x.id) || [],
        conflicts: Object.fromEntries(
          (data.conflicts || []).map((c: { localId: string; diffFields?: Array<{ key: string }> }) => [
            c.localId,
            Object.fromEntries((c.diffFields || []).map((field) => [field.key, "skip" as const])),
          ])
        ),
      });
      setSyncPreviewOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load sync preview");
    } finally {
      setSyncPreviewLoading(false);
    }
  };

  const executeSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/contacts/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syncChoices),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncPreviewOpen(false);
      fetchContacts();
      refreshFavorites();
      void refreshLabelOptions();
      void refreshSupplierLabelGaps();
      setNeedsGoogleSync(false);
      const failureCount = Array.isArray(data.failures) ? data.failures.length : 0;
      if (failureCount > 0) {
        const preview = data.failures
          .slice(0, 5)
          .map((item: { name?: string; stage: string; message: string }) => `${item.name || "Contact"} (${item.stage}): ${item.message}`)
          .join("\n");
        alert(
          `Sync partially completed. Imported: ${data.imported}, Pushed: ${data.pushed}, Failed: ${failureCount}` +
            (preview ? `\n\n${preview}` : "")
        );
      } else {
        alert(`Sync complete. Imported: ${data.imported}, Pushed: ${data.pushed}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const setAllConflictChoices = (choice: "local" | "google" | "skip") => {
    setSyncChoices((current) => ({
      ...current,
      conflicts: Object.fromEntries(
        (syncPreview?.conflicts || []).map((conflict) => [
          conflict.localId,
          Object.fromEntries((conflict.diffFields || []).map((field) => [field.key, choice])),
        ])
      ),
    }));
  };

  const openEdit = (c: Contact) => {
    setEditContact(c);
    const primaryEmail = c.emails?.[0]?.email ?? c.email ?? "";
    const primaryPhone = c.phones?.[0]?.phone ?? c.phone ?? "";
    const emails = c.emails?.length ? c.emails : [];
    const phones = c.phones?.length ? c.phones : [];
    setForm({
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      name: c.name,
      email: emails.length ? "" : primaryEmail,
      phone: phones.length ? "" : primaryPhone,
      company: c.company || "",
      jobTitle: c.jobTitle || "",
      label: c.label || "",
      website: c.website || "",
      notes: c.notes || "",
      emails,
      phones,
      addresses: c.addresses || [],
      significantDates:
        c.significantDates?.map((d) => ({
          label: d.label,
          date: d.date ? new Date(d.date).toISOString().slice(0, 10) : "",
        })) || [],
      relatedPersons: c.relatedPersons || [],
    });
  };

  const primaryEmail = (c: Contact) => c.emails?.[0]?.email ?? c.email ?? "";

  const openComposeSingle = (c: Contact) => {
    const email = primaryEmail(c).trim();
    if (!email) {
      window.alert("This contact has no email address.");
      return;
    }
    setComposeTarget({ recipients: [{ email, name: c.name }] });
  };

  const openComposeSelected = () => {
    const rec = contacts
      .filter((c) => selectedIds.has(c.id))
      .map((c) => ({ email: primaryEmail(c).trim(), name: c.name }))
      .filter((r) => r.email.length > 0);
    if (rec.length === 0) {
      window.alert("None of the selected contacts have an email address.");
      return;
    }
    setComposeTarget({ recipients: rec });
  };

  const listEmailsForContact = (c: Contact): string[] => {
    const fromMulti = (c.emails ?? []).map((e) => e.email?.trim()).filter(Boolean) as string[];
    if (fromMulti.length > 0) return fromMulti;
    return c.email?.trim() ? [c.email.trim()] : [];
  };

  const openSchedule = (_c: Contact) => {
    alert("Energia Scheduler coming soon. This button will open the scheduler to create an event.");
  };

  const togglePriority = async (c: Contact) => {
    const next = !c.isPriority;
    try {
      await fetch("/api/contacts/" + c.id + "/priority", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPriority: next }),
      });
      setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, isPriority: next } : x)));
      refreshFavorites();
      setNeedsGoogleSync(true);
    } catch {}
  };

  const saveVisibleColumns = (cols: Set<string>) => {
    setVisibleColumns(cols);
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(cols)));
    } catch {}
  };

  const openNotesQuick = (c: Contact) => {
    setNotesQuickContact(c);
    setNotesQuickText(c.notes || "");
    setNotesQuickSaving(false);
    setNotesQuickOpen(true);
  };

  const saveNotesQuick = async () => {
    if (!notesQuickContact) return;
    setNotesQuickSaving(true);
    try {
      const res = await fetch(`/api/contacts/${notesQuickContact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesQuickText || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Failed to save notes");
      setNotesQuickOpen(false);
      setNotesQuickContact(null);
      await fetchContacts();
      refreshFavorites();
      setNeedsGoogleSync(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setNotesQuickSaving(false);
    }
  };

  const renderColumnHeader = (colId: string) => {
    if (!visibleColumns.has(colId)) return null;
    switch (colId) {
      case "name":
        return (
          <th key={colId} className="text-left py-2 px-2">
            <SortHeader col="name" label="Name" />
          </th>
        );
      case "notes":
        return (
          <th key={colId} className="text-left py-2 px-2 w-12">
            Notes
          </th>
        );
      case "company":
        return (
          <th key={colId} className="text-left py-2 px-2">
            <SortHeader col="company" label="Company" />
          </th>
        );
      case "email":
        return (
          <th key={colId} className="text-left py-2 px-2">
            <SortHeader col="email" label="Email" />
          </th>
        );
      case "phone":
        return (
          <th key={colId} className="text-left py-2 px-2 min-w-[220px]">
            <SortHeader col="phone" label="Phone" />
          </th>
        );
      case "jobTitle":
        return (
          <th key={colId} className="text-left py-2 px-2">
            <SortHeader col="jobTitle" label="Job Title" />
          </th>
        );
      case "label":
        return (
          <th key={colId} className="text-left py-2 px-2 min-w-[140px]">
            <SortHeader col="label" label="Label" />
          </th>
        );
      case "recentInteractions":
        return (
          <th key={colId} className="text-left py-2 px-2 min-w-[200px]">
            Recent Interactions
          </th>
        );
      case "actions":
        return (
          <th key={colId} className="text-left py-2 px-2 w-32">
            Actions
          </th>
        );
      default:
        return null;
    }
  };

  const renderColumnCell = (c: Contact, colId: string) => {
    if (!visibleColumns.has(colId)) return null;
    switch (colId) {
      case "name":
        return (
          <td key={colId} className="py-2 px-2">
            <div className="font-medium">{c.name}</div>
            {(c.jobTitle || c.label) && !visibleColumns.has("jobTitle") && !visibleColumns.has("label") && (
              <div className="text-xs text-muted-foreground">{[c.jobTitle, c.label].filter(Boolean).join(" • ")}</div>
            )}
          </td>
        );
      case "notes":
        return (
          <td key={colId} className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8"
              onClick={() => openNotesQuick(c)}
              title={c.notes ? "View/edit contact notes" : "Add contact note"}
            >
              <StickyNote className="h-4 w-4" />
              {c.notes ? (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background animate-pulse" />
              ) : null}
            </Button>
          </td>
        );
      case "company":
        return (
          <td key={colId} className="py-2 px-2">
            {c.company || "—"}
          </td>
        );
      case "email": {
        const emails = listEmailsForContact(c);
        return (
          <td key={colId} className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
            {emails.length === 0 ? (
              "—"
            ) : (
              <div className="flex flex-col gap-0.5 items-start">
                {emails.map((em, idx) => (
                  <button
                    key={em + "-" + idx}
                    type="button"
                    className="text-left text-primary hover:underline text-sm font-normal p-0 h-auto bg-transparent border-0 cursor-pointer"
                    onClick={() => setComposeTarget({ recipients: [{ email: em, name: c.name }] })}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </td>
        );
      }
      case "phone":
        return (
          <td key={colId} className="py-2 px-2 min-w-[220px] whitespace-normal">
            {(() => {
              const lines = (
                c.phones?.length
                  ? c.phones.map((p) => p.phone + (p.type ? " (" + p.type + ")" : ""))
                  : [c.phone]
              ).filter(Boolean) as string[];
              if (lines.length === 0) return "—";
              return (
                <div className="flex flex-col gap-0.5">
                  {lines.map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </div>
              );
            })()}
          </td>
        );
      case "jobTitle":
        return (
          <td key={colId} className="py-2 px-2">
            {c.jobTitle || "—"}
          </td>
        );
      case "label":
        return (
          <td key={colId} className="py-2 px-2 min-w-[140px] text-sm">
            {c.label || "—"}
          </td>
        );
      case "recentInteractions":
        return (
          <td key={colId} className="py-2 px-2 min-w-[200px]">
            <div className="space-y-1.5 text-xs">
              {(recentEmails[c.id] || []).length === 0 ? (
                <span className="text-muted-foreground">No recent emails</span>
              ) : (
                (recentEmails[c.id] || []).map((e) => (
                  <a
                    key={e.id}
                    href={"/inbox/email/" + e.id}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate hover:underline"
                    title={e.subject}
                  >
                    <span className="text-muted-foreground">
                      {new Date(e.sentAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    {" — "}
                    {e.subject || "(no subject)"}
                  </a>
                ))
              )}
            </div>
          </td>
        );
      case "actions":
        return (
          <td key={colId} className="py-2 px-2">
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openComposeSingle(c)}
                disabled={!primaryEmail(c).trim()}
                title={primaryEmail(c).trim() ? "Send email to this contact" : "No email address"}
              >
                <Mail className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openSchedule(c)} title="Schedule event">
                <Calendar className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteContact(c)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="px-2 pt-3 pb-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <span className="inline-flex items-center gap-2">
              <Users className="h-6 w-6" />
              Contacts
            </span>
            <span className="text-muted-foreground text-base font-normal">({totalCount})</span>
            {needsGoogleSync && (
              <span
                className="inline-flex items-center gap-2 text-destructive text-sm font-medium"
                title="Local changes need to be synced to Google"
              >
                <AlertTriangle className="h-4 w-4" />
                Local changes pending sync
              </span>
            )}
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage contacts from your database and import from Google Contacts.
          </p>
          {supplierLabelGaps.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    {supplierLabelGaps.length} supplier contact(s) are still missing a `gas` or `electric` label.
                  </p>
                  <p className="mt-1">
                    Review these before building RFPs:{" "}
                    {supplierLabelGaps
                      .slice(0, 8)
                      .map((contact) => contact.company || contact.name)
                      .join(", ")}
                    {supplierLabelGaps.length > 8 ? ", ..." : ""}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-2 pb-3 pt-2">
            <div className="flex flex-wrap items-center gap-2 w-full">
            <Select value={labelFilter} onValueChange={setLabelFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by label" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All labels</SelectItem>
                <SelectItem value="__none__">No label</SelectItem>
                {distinctLabels.map((lb) => (
                  <SelectItem key={lb} value={lb}>
                    {lb}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Input
                placeholder="Search by name, email, phone, company..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-80 max-w-full pr-8"
              />
              {search.trim().length > 0 && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSearch("");
                    setDebouncedSearch("");
                  }}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex-1 min-w-[8px]" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" title="Settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Contact
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleImportGoogle()} disabled={googleContactsBusy}>
                  <Download className="h-4 w-4 mr-2" />
                  {importing ? "Importing…" : "Import from Google"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void openSyncPreview()} disabled={googleContactsBusy}>
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${syncPreviewLoading ? "animate-spin" : ""}`}
                  />
                  {syncPreviewLoading ? "Loading preview…" : "Sync"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setManageColumnsOpen(true)}>
                  Manage Contact columns
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {selectedIds.size > 0 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => openComposeSelected()}
                  title="Send one email to all selected contacts (To: list)"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Email selected ({selectedIds.size})
                </Button>
                <div className="flex-1 min-w-[8px]" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive shrink-0 ml-auto"
                  onClick={() => setDeleteSelectedConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete selected ({selectedIds.size})
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {favorites.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
              Favorites ({favorites.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            <div className="flex flex-wrap gap-2 pb-3">
              {favorites.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <button type="button" onClick={() => togglePriority(c)} title="Remove from favorites">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                  </button>
                  <span className="font-medium">{c.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  {primaryEmail(c) ? (
                    <button
                      type="button"
                      className="text-primary hover:underline text-xs max-w-[200px] truncate text-left"
                      title={primaryEmail(c)}
                      onClick={() => openComposeSingle(c)}
                    >
                      {primaryEmail(c)}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading...</p>
          ) : contacts.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No contacts yet. Add one or import from Google.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 w-[4.5rem] align-top">
                      <div className="flex flex-col items-start gap-1">
                        <input
                          type="checkbox"
                          checked={contacts.length > 0 && selectedIds.size >= contacts.length}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < contacts.length;
                          }}
                          onChange={toggleSelectAll}
                          className="rounded"
                          title="Select or clear all rows in this list"
                        />
                        <div className="flex flex-col gap-0 text-[10px] leading-tight text-muted-foreground">
                          <button type="button" className="hover:text-foreground underline text-left" onClick={selectAllDisplayed}>
                            All
                          </button>
                          <button type="button" className="hover:text-foreground underline text-left" onClick={deselectAllContacts}>
                            None
                          </button>
                        </div>
                      </div>
                    </th>
                    <th className="text-left py-2 px-2 w-10"></th>
                    {TABLE_COLUMN_ORDER.map((colId) => renderColumnHeader(colId))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <button
                          type="button"
                          onClick={() => togglePriority(c)}
                          title={c.isPriority ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className={"h-4 w-4 " + (c.isPriority ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
                        </button>
                      </td>
                      {TABLE_COLUMN_ORDER.map((colId) => renderColumnCell(c, colId))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Contact Form - expanded */}
      <ContactFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Add Contact"
        form={form}
        setForm={setForm}
        onSubmit={handleCreate}
        onReset={() => setForm(emptyForm)}
        googleLabelOptions={googleLabelOptions}
        distinctLabels={distinctLabels}
      />
      <ContactFormDialog
        open={!!editContact}
        onOpenChange={(open) => !open && setEditContact(null)}
        title="Edit Contact"
        form={form}
        setForm={setForm}
        onSubmit={handleUpdate}
        onReset={() => setForm(emptyForm)}
        googleLabelOptions={googleLabelOptions}
        distinctLabels={distinctLabels}
      />

      <Dialog
        open={notesQuickOpen}
        onOpenChange={(open) => {
          setNotesQuickOpen(open);
          if (!open) setNotesQuickContact(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {notesQuickContact ? `Contact notes — ${notesQuickContact.name}` : "Contact notes"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Notes here are stored only on this contact (separate from customer/contract notes).
          </p>
          <textarea
            className="w-full min-h-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={notesQuickText}
            onChange={(e) => setNotesQuickText(e.target.value)}
            placeholder="Imported from Google Contact notes when available..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesQuickOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveNotesQuick()} disabled={notesQuickSaving}>
              {notesQuickSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteContact}
        onOpenChange={(open) => !open && setDeleteContact(null)}
        title="Delete contact"
        message={deleteContact ? "Are you sure you want to delete " + deleteContact.name + "?" : ""}
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={deleteSelectedConfirm}
        onOpenChange={setDeleteSelectedConfirm}
        title="Delete selected contacts"
        message={"Delete " + selectedIds.size + " selected contact(s)? This will not affect Google Contacts."}
        confirmLabel="Delete"
        onConfirm={handleDeleteSelected}
      />

      <Dialog open={manageColumnsOpen} onOpenChange={setManageColumnsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Contact Columns</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <p className="text-sm text-muted-foreground">Select which columns to display in the contacts table.</p>
            {AVAILABLE_COLUMNS.map((col) => (
              <label key={col.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col.id)}
                  onChange={(e) => {
                    const next = new Set(visibleColumns);
                    if (e.target.checked) next.add(col.id);
                    else next.delete(col.id);
                    saveVisibleColumns(next);
                  }}
                  className="rounded"
                />
                {col.label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageColumnsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Caution Dialog */}
      <Dialog open={syncPreviewOpen} onOpenChange={setSyncPreviewOpen}>
        <DialogContent className="max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Sync Preview — Review Changes ({syncChangeCount} changes)
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-4 py-4">
            {syncPreview && (
              <>
                {syncPreview.incomingFromGoogle?.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Incoming from Google ({syncPreview.incomingFromGoogle.length})</h4>
                    <div className="border rounded p-2 max-h-32 overflow-auto space-y-1 text-sm">
                      {syncPreview.incomingFromGoogle.map((x) => (
                        <label key={x.resourceName} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={syncChoices.incoming.includes(x.resourceName)}
                            onChange={(e) =>
                              setSyncChoices((s) => ({
                                ...s,
                                incoming: e.target.checked
                                  ? [...s.incoming, x.resourceName]
                                  : s.incoming.filter((r) => r !== x.resourceName),
                              }))
                            }
                          />
                          {x.name} {x.email && "(" + x.email + ")"}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {syncPreview.outgoingToGoogle?.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Outgoing to Google ({syncPreview.outgoingToGoogle.length})</h4>
                    <div className="border rounded p-2 max-h-32 overflow-auto space-y-1 text-sm">
                      {syncPreview.outgoingToGoogle.map((x) => (
                        <label key={x.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={syncChoices.outgoing.includes(x.id)}
                            onChange={(e) =>
                              setSyncChoices((s) => ({
                                ...s,
                                outgoing: e.target.checked
                                  ? [...s.outgoing, x.id]
                                  : s.outgoing.filter((id) => id !== x.id),
                              }))
                            }
                          />
                          {x.name} {x.email && "(" + x.email + ")"} — {x.change}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {syncPreview.conflicts?.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2 text-amber-600">Conflicts — choose which version to keep</h4>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setAllConflictChoices("local")}>
                        Select all local
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setAllConflictChoices("google")}>
                        Select all Google
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setAllConflictChoices("skip")}>
                        Deselect all
                      </Button>
                    </div>
                    <div className="border border-amber-200 rounded p-2 space-y-3 text-sm">
                      {syncPreview.conflicts.map((c) => (
                        <div key={c.localId} className="p-2 bg-amber-50 dark:bg-amber-950/30 rounded">
                          <div className="font-medium">{c.name}</div>
                          {c.diffFields?.length > 0 && (
                            <div className="mt-2 overflow-x-auto rounded border bg-background">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b bg-muted/50">
                                    <th className="px-3 py-2 text-left font-medium">Field</th>
                                    <th className="px-3 py-2 text-left font-medium">Local Energia</th>
                                    <th className="px-3 py-2 text-left font-medium">Google Contacts</th>
                                    <th className="px-3 py-2 text-left font-medium">Choice</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.diffFields.map((field) => (
                                    <tr key={field.key} className="border-b last:border-b-0 align-top">
                                      <td className="px-3 py-2 font-medium text-foreground">{field.label}</td>
                                      <td className="px-3 py-2 text-muted-foreground whitespace-pre-wrap break-words">
                                        {field.localValue}
                                      </td>
                                      <td className="px-3 py-2 text-muted-foreground whitespace-pre-wrap break-words">
                                        {field.googleValue}
                                      </td>
                                      <td className="px-3 py-2">
                                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                                          <label className="flex items-center gap-2">
                                            <input
                                              type="radio"
                                              name={`conflict-${c.localId}-${field.key}`}
                                              checked={syncChoices.conflicts[c.localId]?.[field.key] === "local"}
                                              onChange={() =>
                                                setSyncChoices((s) => ({
                                                  ...s,
                                                  conflicts: {
                                                    ...s.conflicts,
                                                    [c.localId]: {
                                                      ...(s.conflicts[c.localId] || {}),
                                                      [field.key]: "local",
                                                    },
                                                  },
                                                }))
                                              }
                                            />
                                            <span>Keep Local Version</span>
                                          </label>
                                          <label className="flex items-center gap-2">
                                            <input
                                              type="radio"
                                              name={`conflict-${c.localId}-${field.key}`}
                                              checked={syncChoices.conflicts[c.localId]?.[field.key] === "google"}
                                              onChange={() =>
                                                setSyncChoices((s) => ({
                                                  ...s,
                                                  conflicts: {
                                                    ...s.conflicts,
                                                    [c.localId]: {
                                                      ...(s.conflicts[c.localId] || {}),
                                                      [field.key]: "google",
                                                    },
                                                  },
                                                }))
                                              }
                                            />
                                            <span>Keep Google Contacts Version</span>
                                          </label>
                                          <label className="flex items-center gap-2">
                                            <input
                                              type="radio"
                                              name={`conflict-${c.localId}-${field.key}`}
                                              checked={syncChoices.conflicts[c.localId]?.[field.key] === "skip"}
                                              onChange={() =>
                                                setSyncChoices((s) => ({
                                                  ...s,
                                                  conflicts: {
                                                    ...s.conflicts,
                                                    [c.localId]: {
                                                      ...(s.conflicts[c.localId] || {}),
                                                      [field.key]: "skip",
                                                    },
                                                  },
                                                }))
                                              }
                                            />
                                            <span>Skip</span>
                                          </label>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {syncPreview.incomingFromGoogle?.length === 0 &&
                  syncPreview.outgoingToGoogle?.length === 0 &&
                  (syncPreview.conflicts?.length || 0) === 0 && (
                    <p className="text-muted-foreground">No changes to sync.</p>
                  )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncPreviewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={executeSync} disabled={syncing}>
              {syncing ? "Syncing..." : "Apply Sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {googleContactsBusy ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-sm"
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-labelledby="google-contacts-loading-title"
        >
          <div className="mx-4 flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card px-8 py-10 text-center shadow-lg">
            <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden />
            <div>
              <p id="google-contacts-loading-title" className="text-lg font-semibold">
                {importing
                  ? "Importing from Google Contacts"
                  : syncPreviewLoading
                    ? "Loading changes from Google"
                    : "Syncing with Google"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                This may take a little while. Please wait and keep this tab open.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <ComposeModal target={composeTarget} onClose={() => setComposeTarget(null)} onSent={() => setComposeTarget(null)} />
    </div>
  );
}

function ComposeModal({
  target,
  onClose,
  onSent,
}: {
  target: ComposeTarget | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const recipientsKey = target?.recipients?.map((r) => r.email).join("\n") ?? "";

  useEffect(() => {
    if (target) {
      setSubject("");
      setBody("");
      setSending(false);
    }
  }, [recipientsKey]);

  if (!target?.recipients?.length) return null;

  const toList = target.recipients.map((r) => r.email.trim()).filter(Boolean);
  const toDisplay = target.recipients
    .filter((r) => r.email.trim())
    .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
    .join(", ");

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (toList.length === 0) return;
    setSending(true);
    try {
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toList, subject: subject || "(no subject)", body }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onSent();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compose Email</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSend} className="space-y-4 py-4">
          <div className="grid gap-2">
            <Label>To {toList.length > 1 ? `(${toList.length})` : null}</Label>
            <textarea
              readOnly
              className="min-h-[72px] max-h-[180px] w-full rounded-md border border-input bg-muted px-3 py-2 text-sm resize-y"
              value={toDisplay}
            />
          </div>
          <div className="grid gap-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <div className="grid gap-2">
            <Label>Message</Label>
            <textarea
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContactFormDialog({
  open,
  onOpenChange,
  title,
  form,
  setForm,
  onSubmit,
  onReset,
  googleLabelOptions,
  distinctLabels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  onSubmit: (e: React.FormEvent) => void;
  onReset: () => void;
  googleLabelOptions: string[];
  distinctLabels: string[];
}) {
  const labelPresets = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...distinctLabels, ...googleLabelOptions]) {
      const t = x.trim();
      if (!t) continue;
      m.set(t.toLowerCase(), t);
    }
    return Array.from(m.values());
  }, [distinctLabels, googleLabelOptions]);
  const addEmail = () =>
    setForm((f) => ({
      ...f,
      emails:
        f.emails.length === 0 && f.email
          ? [{ email: f.email, type: "work" }, { email: "", type: "work" }]
          : [...f.emails, { email: "", type: "work" }],
      email: f.emails.length > 0 ? f.email : "",
    }));
  const addPhone = () =>
    setForm((f) => ({
      ...f,
      phones:
        f.phones.length === 0 && f.phone
          ? [{ phone: f.phone, type: "work" }, { phone: "", type: "work" }]
          : [...f.phones, { phone: "", type: "work" }],
      phone: f.phones.length > 0 ? f.phone : "",
    }));
  const addAddress = () => setForm((f) => ({ ...f, addresses: [...f.addresses, {}] }));
  const addDate = () => setForm((f) => ({ ...f, significantDates: [...f.significantDates, { label: "", date: "" }] }));
  const addRelated = () => setForm((f) => ({ ...f, relatedPersons: [...f.relatedPersons, { name: "", relation: "" }] }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onReset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>First Name</Label>
              <Input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Name * (or leave blank to use First + Last)</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Full display name"
            />
          </div>
          <div>
            <Label>Company</Label>
            <Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
          </div>
          <div>
            <Label>Job Title</Label>
            <Input value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} />
          </div>

          <div>
            <div className="flex justify-between items-center">
              <Label>Emails</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addEmail}>
                + Add
              </Button>
            </div>
            {form.emails.length === 0 ? (
              <Input
                type="email"
                placeholder="Primary email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1"
              />
            ) : (
              form.emails.map((e, i) => (
                <div key={i} className="flex gap-2 mt-1">
                  <Input
                    type="email"
                    value={e.email}
                    onChange={(ev) =>
                      setForm((f) => ({
                        ...f,
                        emails: f.emails.map((em, j) => (j === i ? { ...em, email: ev.target.value } : em)),
                      }))
                    }
                    placeholder="Email"
                  />
                  <select
                    value={e.type || "work"}
                    onChange={(ev) =>
                      setForm((f) => ({
                        ...f,
                        emails: f.emails.map((em, j) => (j === i ? { ...em, type: ev.target.value } : em)),
                      }))
                    }
                    className="h-9 rounded border px-2"
                  >
                    <option value="work">Work</option>
                    <option value="home">Home</option>
                    <option value="other">Other</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setForm((f) => ({ ...f, emails: f.emails.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div>
            <div className="flex justify-between items-center">
              <Label>Phones</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addPhone}>
                + Add
              </Button>
            </div>
            {form.phones.length === 0 ? (
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Primary phone"
                className="mt-1"
              />
            ) : (
              form.phones.map((p, i) => (
                <div key={i} className="flex gap-2 mt-1">
                  <Input
                    value={p.phone}
                    onChange={(ev) =>
                      setForm((f) => ({
                        ...f,
                        phones: f.phones.map((ph, j) => (j === i ? { ...ph, phone: ev.target.value } : ph)),
                      }))
                    }
                    placeholder="Phone"
                  />
                  <select
                    value={p.type || "work"}
                    onChange={(ev) =>
                      setForm((f) => ({
                        ...f,
                        phones: f.phones.map((ph, j) => (j === i ? { ...ph, type: ev.target.value } : ph)),
                      }))
                    }
                    className="h-9 rounded border px-2"
                  >
                    <option value="work">Work</option>
                    <option value="home">Home</option>
                    <option value="mobile">Mobile</option>
                    <option value="fax">Fax</option>
                    <option value="other">Other</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setForm((f) => ({ ...f, phones: f.phones.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div>
            <div className="flex justify-between items-center">
              <Label>Addresses</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addAddress}>
                + Add
              </Button>
            </div>
            {form.addresses.map((a, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 mt-1 p-2 border rounded">
                <Input
                  value={a.street || ""}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      addresses: f.addresses.map((ad, j) =>
                        j === i ? { ...ad, street: ev.target.value } : ad
                      ),
                    }))
                  }
                  placeholder="Street"
                />
                <Input
                  value={a.city || ""}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      addresses: f.addresses.map((ad, j) =>
                        j === i ? { ...ad, city: ev.target.value } : ad
                      ),
                    }))
                  }
                  placeholder="City"
                />
                <Input
                  value={a.state || ""}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      addresses: f.addresses.map((ad, j) =>
                        j === i ? { ...ad, state: ev.target.value } : ad
                      ),
                    }))
                  }
                  placeholder="State"
                />
                <Input
                  value={a.zip || ""}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      addresses: f.addresses.map((ad, j) =>
                        j === i ? { ...ad, zip: ev.target.value } : ad
                      ),
                    }))
                  }
                  placeholder="Zip"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setForm((f) => ({ ...f, addresses: f.addresses.filter((_, j) => j !== i) }))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <div>
            <div className="flex justify-between items-center">
              <Label>Significant Dates (e.g. Contract Expiration)</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addDate}>
                + Add
              </Button>
            </div>
            {form.significantDates.map((d, i) => (
              <div key={i} className="flex gap-2 mt-1">
                <Input
                  value={d.label}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      significantDates: f.significantDates.map((sd, j) =>
                        j === i ? { ...sd, label: ev.target.value } : sd
                      ),
                    }))
                  }
                  placeholder="Label"
                />
                <Input
                  type="date"
                  value={d.date}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      significantDates: f.significantDates.map((sd, j) =>
                        j === i ? { ...sd, date: ev.target.value } : sd
                      ),
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      significantDates: f.significantDates.filter((_, j) => j !== i),
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div>
            <div className="flex justify-between items-center">
              <Label>Related Persons</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addRelated}>
                + Add
              </Button>
            </div>
            {form.relatedPersons.map((r, i) => (
              <div key={i} className="flex gap-2 mt-1">
                <Input
                  value={r.name}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      relatedPersons: f.relatedPersons.map((rp, j) =>
                        j === i ? { ...rp, name: ev.target.value } : rp
                      ),
                    }))
                  }
                  placeholder="Name"
                />
                <Input
                  value={r.relation || ""}
                  onChange={(ev) =>
                    setForm((f) => ({
                      ...f,
                      relatedPersons: f.relatedPersons.map((rp, j) =>
                        j === i ? { ...rp, relation: ev.target.value } : rp
                      ),
                    }))
                  }
                  placeholder="Relation"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      relatedPersons: f.relatedPersons.filter((_, j) => j !== i),
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <ContactLabelsField
            value={form.label}
            onChange={(label) => setForm((f) => ({ ...f, label }))}
            presetLabels={labelPresets}
            description="Select any combination. Saved comma-separated (same as filters & directory rules). For Google Sync, new names are created on the next sync when applicable."
            idPrefix="contact-form-label"
          />
          <div>
            <Label>Website</Label>
            <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              className="w-full min-h-[60px] rounded border px-3 py-2 text-sm"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {title === "Add Contact" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
