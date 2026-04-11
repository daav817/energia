"use client";

import { useEffect, useMemo, useState } from "react";
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
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/utils";
import {
  customerContactCandidatesForContract,
  getPrimaryContactPromptKind,
  labelHasPrimaryLabel,
  mergePrimaryIntoCustomerLabel,
  stripPrimaryTokenFromLabel,
  type ContactLike,
} from "@/lib/contract-main-contact";

type ContractMini = {
  id: string;
  customerId: string;
  mainContactId: string | null;
  customer: { name: string; company: string | null };
};

export function PrimaryCustomerContactDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: ContractMini | null;
  directory: ContactLike[];
  onUpdated: () => void;
}) {
  const { open, onOpenChange, contract, directory, onUpdated } = props;
  const kind = useMemo(
    () => (contract ? getPrimaryContactPromptKind(contract, directory) : "none"),
    [contract, directory]
  );
  const candidates = useMemo(
    () => (contract ? customerContactCandidatesForContract(contract, directory) : []),
    [contract, directory]
  );

  const [selectedId, setSelectedId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !contract) return;
    setError(null);
    setBusy(false);
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

  const companyForContact = contract?.customer.company?.trim() || contract?.customer.name || "";

  const applyPrimaryToSelected = async () => {
    if (!contract || !selectedId) return;
    setBusy(true);
    setError(null);
    try {
      for (const c of candidates) {
        if (!c.id || c.id === selectedId) continue;
        if (!labelHasPrimaryLabel(c.label)) continue;
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

      const chosen = candidates.find((c) => c.id === selectedId);
      if (!chosen?.id) throw new Error("Select a contact");
      const merged = mergePrimaryIntoCustomerLabel(chosen.label);
      const res2 = await fetch(`/api/contacts/${encodeURIComponent(chosen.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: merged }),
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
              <Label>Select contact</Label>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => c.id && setSelectedId(c.id)}
                      className={cn(
                        "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                        selectedId === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      )}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="block text-xs opacity-80">{(c.label || "(no label)").trim() || "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : kind === "no_customer_contacts" ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              No contacts are tagged for this customer yet (label should include <strong>customer</strong>). Create a
              contact linked to <strong>{contract.customer.name}</strong> with a{" "}
              <strong className="text-foreground">customer, primary</strong> label.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="pc-name">Name *</Label>
              <Input
                id="pc-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {kind === "missing_primary" && candidates.length > 0 ? (
            <Button type="button" disabled={!selectedId || busy} onClick={() => void applyPrimaryToSelected()}>
              {busy ? "Saving…" : "Save primary contact"}
            </Button>
          ) : null}
          {kind === "no_customer_contacts" ? (
            <Button type="button" disabled={busy || !newName.trim()} onClick={() => void createPrimaryContact()}>
              {busy ? "Creating…" : "Create & link"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
