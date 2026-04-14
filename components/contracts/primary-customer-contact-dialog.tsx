"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/utils";
import {
  customerContactCandidatesForContract,
  getPrimaryContactPromptKind,
  labelHasCustomerLabel,
  labelHasPrimaryLabel,
  mergePrimaryIntoCustomerLabel,
  stripPrimaryTokenFromLabel,
  type ContactLike,
} from "@/lib/contract-main-contact";

type CustomerMini = { id: string; name: string; company: string | null };

type ContractMini = {
  id: string;
  customerId: string;
  mainContactId: string | null;
  customer: { name: string; company: string | null };
};

function buildCustomerMap(customers: CustomerMini[]) {
  return new Map(customers.map((x) => [x.id, x]));
}

/** Match if every whitespace-separated token appears somewhere in name, company, or linked customer fields. */
function contactMatchesSearch(c: ContactLike, q: string, customerById: Map<string, CustomerMini>): boolean {
  const raw = q.trim().toLowerCase();
  if (!raw) return true;
  const parts = raw.split(/\s+/).filter(Boolean);
  const cust = c.customerId ? customerById.get(c.customerId) : undefined;
  const hay = [
    c.name,
    c.company,
    cust?.name,
    cust?.company,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return parts.every((p) => hay.includes(p));
}

function PrimaryContactBadge({ selected }: { selected: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 px-1.5 py-0 text-[10px] font-semibold",
        selected
          ? "border-primary-foreground/50 bg-primary-foreground/15 text-primary-foreground"
          : "border-amber-700/45 bg-amber-500/15 text-amber-950 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-100"
      )}
    >
      Primary
    </Badge>
  );
}

function contactsToStripPrimaryFrom(
  contract: ContractMini,
  directory: ContactLike[],
  chosenId: string
): ContactLike[] {
  const fromCand = customerContactCandidatesForContract(contract, directory).filter(
    (c) => c.id && c.id !== chosenId && labelHasPrimaryLabel(c.label)
  );
  const seen = new Set(fromCand.map((c) => c.id));
  const byCust = directory.filter(
    (c) =>
      c.id &&
      c.id !== chosenId &&
      c.customerId === contract.customerId &&
      labelHasPrimaryLabel(c.label) &&
      !seen.has(c.id)
  );
  return [...fromCand, ...byCust];
}

export function PrimaryCustomerContactDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: ContractMini | null;
  directory: ContactLike[];
  customers: CustomerMini[];
  onUpdated: () => void;
}) {
  const { open, onOpenChange, contract, directory, customers, onUpdated } = props;
  const kind = useMemo(
    () => (contract ? getPrimaryContactPromptKind(contract, directory) : "none"),
    [contract, directory]
  );
  const candidates = useMemo(
    () => (contract ? customerContactCandidatesForContract(contract, directory) : []),
    [contract, directory]
  );

  const customerById = useMemo(() => buildCustomerMap(customers), [customers]);

  const [contactSearch, setContactSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedAssignId, setSelectedAssignId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredCandidates = useMemo(
    () => candidates.filter((c) => contactMatchesSearch(c, contactSearch, customerById)),
    [candidates, contactSearch, customerById]
  );

  const assignableCustomerContacts = useMemo(
    () =>
      directory.filter(
        (c) => c.id && labelHasCustomerLabel(c.label) && contactMatchesSearch(c, contactSearch, customerById)
      ),
    [directory, contactSearch, customerById]
  );

  useEffect(() => {
    if (!open || !contract) return;
    setError(null);
    setBusy(false);
    setContactSearch("");
    setSelectedAssignId("");
    if (kind === "missing_primary" && candidates.length > 0) {
      const primaryFirst = candidates.find((c) => c.id && labelHasPrimaryLabel(c.label));
      setSelectedId(primaryFirst?.id ?? candidates[0]?.id ?? "");
    } else {
      setSelectedId("");
    }
    setNewName("");
    setNewEmail("");
    setNewPhone("");
  }, [open, contract, kind, candidates]);

  useEffect(() => {
    if (kind !== "missing_primary") return;
    if (filteredCandidates.length === 0) {
      setSelectedId("");
      return;
    }
    if (!selectedId || !filteredCandidates.some((c) => c.id === selectedId)) {
      setSelectedId(filteredCandidates[0]?.id ?? "");
    }
  }, [kind, filteredCandidates, selectedId]);

  useEffect(() => {
    if (kind !== "no_customer_contacts") return;
    if (assignableCustomerContacts.length === 0) {
      setSelectedAssignId("");
      return;
    }
    if (!selectedAssignId || !assignableCustomerContacts.some((c) => c.id === selectedAssignId)) {
      setSelectedAssignId("");
    }
  }, [kind, assignableCustomerContacts, selectedAssignId]);

  const companyForContact = contract?.customer.company?.trim() || contract?.customer.name || "";

  const finalizePrimaryAndLinkContract = async (chosen: ContactLike) => {
    if (!contract) return;
    if (!chosen?.id) throw new Error("Select a contact");
    const companyVal = contract.customer.company?.trim() || contract.customer.name || null;

    for (const c of contactsToStripPrimaryFrom(contract, directory, chosen.id)) {
      if (!c.id) continue;
      const nextLab = stripPrimaryTokenFromLabel(c.label);
      const labelToSave = nextLab.trim() ? nextLab : "customer";
      const res = await fetch(`/api/contacts/${encodeURIComponent(c.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelToSave }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Failed to update contact label");
    }

    const merged = mergePrimaryIntoCustomerLabel(chosen.label);
    const res2 = await fetch(`/api/contacts/${encodeURIComponent(chosen.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: contract.customerId,
        company: companyVal,
        label: merged,
      }),
    });
    const json2 = await res2.json().catch(() => ({}));
    if (!res2.ok) throw new Error(typeof json2.error === "string" ? json2.error : "Failed to set primary label");

    const res3 = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mainContactId: chosen.id }),
    });
    const json3 = await res3.json().catch(() => ({}));
    if (!res3.ok) throw new Error(typeof json3.error === "string" ? json3.error : "Failed to link main contact");
  };

  const applyPrimaryToSelected = async () => {
    if (!contract || !selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = candidates.find((c) => c.id === selectedId);
      if (!chosen?.id) throw new Error("Select a contact");
      await finalizePrimaryAndLinkContract(chosen);
      onUpdated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const assignExistingCustomerContact = async () => {
    if (!contract || !selectedAssignId) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = directory.find((c) => c.id === selectedAssignId);
      if (!chosen?.id) throw new Error("Select a contact");
      await finalizePrimaryAndLinkContract(chosen);
      onUpdated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const createPrimaryContact = async () => {
    if (!contract) return;
    const name = newName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          company: companyForContact || null,
          customerId: contract.customerId,
          label: "customer, primary",
          email: newEmail.trim() || null,
          phone: newPhone.trim() || null,
          emails: newEmail.trim() ? [{ email: newEmail.trim(), type: "work" }] : [],
          phones: newPhone.trim() ? [{ phone: newPhone.trim(), type: "work" }] : [],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Failed to create contact");

      const res2 = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainContactId: json.id }),
      });
      const json2 = await res2.json().catch(() => ({}));
      if (!res2.ok) throw new Error(typeof json2.error === "string" ? json2.error : "Failed to set main contact");

      onUpdated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  if (!contract) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {kind === "no_customer_contacts" ? "Add primary customer contact" : "Mark primary customer contact"}
          </DialogTitle>
        </DialogHeader>

        {kind === "missing_primary" && candidates.length > 0 ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              This contract&apos;s main customer contact should include{" "}
              <strong className="text-foreground">primary</strong> in the contact label. Choose who is the primary
              contact for <strong>{contract.customer.name}</strong>. Other customer contacts will have &quot;primary&quot;
              removed from their label so only one stays primary.
            </p>
            <div className="space-y-2">
              <Label htmlFor="pc-search-missing">Search by contact name, company, or customer</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pc-search-missing"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Type to filter…"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Select contact</Label>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {filteredCandidates.length === 0 ? (
                  <li className="px-2 py-3 text-center text-muted-foreground">No contacts match this search.</li>
                ) : (
                  filteredCandidates.map((c) => {
                    const cust = c.customerId ? customerById.get(c.customerId) : undefined;
                    const custLine =
                      cust?.company?.trim() || cust?.name
                        ? [cust.name, cust.company].filter(Boolean).join(" · ")
                        : (c.company || "").trim() || null;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => c.id && setSelectedId(c.id)}
                          className={cn(
                            "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                            selectedId === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-medium">{c.name}</span>
                            {labelHasPrimaryLabel(c.label) ? (
                              <PrimaryContactBadge selected={selectedId === c.id} />
                            ) : null}
                          </div>
                          {custLine ? (
                            <span className="block text-xs opacity-80">{custLine}</span>
                          ) : null}
                          <span className="block text-xs opacity-80">{(c.label || "(no label)").trim() || "—"}</span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : kind === "no_customer_contacts" ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              No directory contacts match this customer yet. Search existing <strong>customer</strong>-labeled contacts
              below (by person, company, or linked customer record), or create a new contact for{" "}
              <strong>{contract.customer.name}</strong>.
            </p>
            <div className="space-y-2">
              <Label htmlFor="pc-search-assign">Search contacts</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pc-search-assign"
                  value={contactSearch}
                  onChange={(e) => {
                    setContactSearch(e.target.value);
                    setSelectedAssignId("");
                    setNewName("");
                  }}
                  placeholder="Name, company, or customer…"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Assign existing contact</Label>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {assignableCustomerContacts.length === 0 ? (
                  <li className="px-2 py-3 text-center text-muted-foreground text-xs">
                    No customer-tagged contacts match. Clear the search or add labels in Contacts.
                  </li>
                ) : (
                  assignableCustomerContacts.map((c) => {
                    const cust = c.customerId ? customerById.get(c.customerId) : undefined;
                    const custLine =
                      cust?.company?.trim() || cust?.name
                        ? [cust.name, cust.company].filter(Boolean).join(" · ")
                        : (c.company || "").trim() || null;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!c.id) return;
                            setSelectedAssignId((prev) => (prev === c.id ? "" : (c.id ?? "")));
                            setNewName("");
                          }}
                          className={cn(
                            "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                            selectedAssignId === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-medium">{c.name}</span>
                            {labelHasPrimaryLabel(c.label) ? (
                              <PrimaryContactBadge selected={selectedAssignId === c.id} />
                            ) : null}
                          </div>
                          {custLine ? (
                            <span className="block text-xs opacity-80">{custLine}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground border-t pt-3">
              Or create a new contact (company on record: {companyForContact || "—"}).
            </p>
            <div className="grid gap-2">
              <Label htmlFor="pc-name">Name *</Label>
              <Input
                id="pc-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (e.target.value.trim()) setSelectedAssignId("");
                }}
                placeholder="Contact name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pc-email">Email</Label>
              <Input
                id="pc-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pc-phone">Phone</Label>
              <PhoneInput
                id="pc-phone"
                value={newPhone}
                onChange={setNewPhone}
                placeholder="Optional"
              />
            </div>
            <p className="text-xs text-muted-foreground">Company on the contact: {companyForContact || "—"}</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing to configure for this contract.</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {kind === "missing_primary" && candidates.length > 0 ? (
            <Button type="button" disabled={!selectedId || busy} onClick={() => void applyPrimaryToSelected()}>
              {busy ? "Saving…" : "Save primary contact"}
            </Button>
          ) : null}
          {kind === "no_customer_contacts" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !selectedAssignId}
                onClick={() => void assignExistingCustomerContact()}
              >
                {busy ? "Saving…" : "Assign selected & link"}
              </Button>
              <Button
                type="button"
                disabled={busy || !newName.trim() || !!selectedAssignId}
                onClick={() => void createPrimaryContact()}
              >
                {busy ? "Creating…" : "Create & link"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
