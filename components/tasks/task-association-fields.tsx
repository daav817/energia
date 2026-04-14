"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type ContactMini = { id: string; name: string; company: string | null; email: string | null };
type ContractMini = {
  id: string;
  energyType: string;
  customer: { name: string; company: string | null };
  supplier: { name: string };
};

function contractRowLabel(c: ContractMini): string {
  const co = (c.customer.company ?? "").trim() || c.customer.name;
  const et = c.energyType === "ELECTRIC" ? "Electric" : "Natural Gas";
  return `${co} · ${c.supplier.name} · ${et}`;
}

export function TaskAssociationFields(props: {
  contactId: string;
  contractId: string;
  onContactId: (id: string) => void;
  onContractId: (id: string) => void;
}) {
  const { contactId, contractId, onContactId, onContractId } = props;
  const [contacts, setContacts] = useState<ContactMini[]>([]);
  const [contracts, setContracts] = useState<ContractMini[]>([]);
  const [contactQ, setContactQ] = useState("");
  const [contractQ, setContractQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cRes, kRes] = await Promise.all([
          fetch("/api/contacts"),
          fetch("/api/contracts?tab=active&sort=expirationDate&order=asc&mergeRecentExpiredDays=30"),
        ]);
        const cj = cRes.ok ? await cRes.json() : {};
        const kj = kRes.ok ? await kRes.json() : [];
        if (cancelled) return;
        const raw = (cj.contacts ?? cj) as unknown;
        const clist = Array.isArray(raw) ? (raw as ContactMini[]) : [];
        setContacts(
          clist.map((x) => ({
            id: x.id,
            name: x.name,
            company: x.company ?? null,
            email: x.email ?? null,
          }))
        );
        setContracts(Array.isArray(kj) ? (kj as ContractMini[]) : []);
      } catch {
        if (!cancelled) {
          setContacts([]);
          setContracts([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredContacts = useMemo(() => {
    const q = contactQ.trim().toLowerCase();
    if (!q) return contacts.slice(0, 80);
    return contacts
      .filter((c) => {
        const hay = [c.name, c.company, c.email].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 80);
  }, [contacts, contactQ]);

  const filteredContracts = useMemo(() => {
    const q = contractQ.trim().toLowerCase();
    if (!q) return contracts.slice(0, 80);
    return contracts
      .filter((c) => contractRowLabel(c).toLowerCase().includes(q))
      .slice(0, 80);
  }, [contracts, contractQ]);

  const selectedContact = contacts.find((c) => c.id === contactId);
  const selectedContract = contracts.find((c) => c.id === contractId);

  return (
    <div className="grid gap-4 border-t pt-3">
      <div className="grid gap-2">
        <Label>Related contact (optional)</Label>
        <Input
          placeholder="Filter by name, company, email…"
          value={contactQ}
          onChange={(e) => setContactQ(e.target.value)}
        />
        {selectedContact && (
          <p className="text-xs text-muted-foreground">
            Selected: {selectedContact.name}
            {selectedContact.company ? ` · ${selectedContact.company}` : ""}
          </p>
        )}
        <div className="max-h-32 overflow-auto rounded border text-sm">
          <button
            type="button"
            className="block w-full px-2 py-1.5 text-left hover:bg-muted/60 text-muted-foreground"
            onClick={() => onContactId("")}
          >
            None
          </button>
          {filteredContacts.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`block w-full px-2 py-1.5 text-left hover:bg-muted/60 ${
                c.id === contactId ? "bg-primary/10 font-medium" : ""
              }`}
              onClick={() => onContactId(c.id)}
            >
              {c.name}
              {c.company ? ` · ${c.company}` : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Related contract (optional)</Label>
        <Input
          placeholder="Filter by customer, supplier, energy…"
          value={contractQ}
          onChange={(e) => setContractQ(e.target.value)}
        />
        {selectedContract && (
          <p className="text-xs text-muted-foreground">Selected: {contractRowLabel(selectedContract)}</p>
        )}
        <div className="max-h-32 overflow-auto rounded border text-sm">
          <button
            type="button"
            className="block w-full px-2 py-1.5 text-left hover:bg-muted/60 text-muted-foreground"
            onClick={() => onContractId("")}
          >
            None
          </button>
          {filteredContracts.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`block w-full px-2 py-1.5 text-left hover:bg-muted/60 ${
                c.id === contractId ? "bg-primary/10 font-medium" : ""
              }`}
              onClick={() => onContractId(c.id)}
            >
              {contractRowLabel(c)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function taskContactLine(
  c: { name: string; company?: string | null } | null | undefined
): string | null {
  if (!c) return null;
  return `${c.name}${c.company ? ` · ${c.company}` : ""}`;
}

export function taskContractLine(
  c:
    | {
        customer: { name: string; company: string | null };
        supplier: { name: string };
        energyType: string;
      }
    | null
    | undefined
): string | null {
  if (!c) return null;
  const co = (c.customer.company ?? "").trim() || c.customer.name;
  const et = c.energyType === "ELECTRIC" ? "Electric" : "Gas";
  return `${co} / ${c.supplier.name} · ${et}`;
}
