"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ComposeEmailModal, type ComposeEmailTarget } from "@/components/compose-email-modal";

type ContractPayload = {
  id: string;
  energyType?: string;
  status?: string;
  startDate?: string | null;
  expirationDate?: string | null;
  signedDate?: string | null;
  pricePerUnit?: unknown;
  priceUnit?: string;
  brokerMargin?: unknown;
  brokerMarginUnit?: string | null;
  customer?: { name: string };
  supplier?: { name: string };
  mainContact?: { id: string; name: string } | null;
};

type ContactDetail = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  label: string | null;
  website: string | null;
  notes: string | null;
  emails?: Array<{ email: string; type?: string | null }>;
  phones?: Array<{ phone: string; type?: string | null }>;
  addresses?: Array<{
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    type?: string | null;
  }>;
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function contactEmailList(c: ContactDetail): Array<{ email: string; type?: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ email: string; type?: string | null }> = [];
  const add = (email: string, type?: string | null) => {
    const k = email.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ email, type: type ?? null });
  };
  if (c.emails?.length) {
    for (const r of c.emails) add(r.email, r.type ?? null);
  }
  if (c.email) add(c.email, null);
  return out;
}

export function ScheduleContractModal(props: {
  contractId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { contractId, open, onOpenChange } = props;
  const [data, setData] = useState<ContractPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactData, setContactData] = useState<ContactDetail | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [emailComposeTo, setEmailComposeTo] = useState<ComposeEmailTarget | null>(null);

  useEffect(() => {
    if (!open || !contractId) {
      setData(null);
      setError(null);
      setContactOpen(false);
      setContactId(null);
      setEmailComposeTo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Failed to load contract");
        }
        if (!cancelled) setData(json as ContractPayload);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contractId]);

  useEffect(() => {
    if (!contactOpen || !contactId) {
      setContactData(null);
      setContactError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setContactLoading(true);
      setContactError(null);
      try {
        const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Failed to load contact");
        }
        if (!cancelled) setContactData(json as ContactDetail);
      } catch (e) {
        if (!cancelled) {
          setContactError(e instanceof Error ? e.message : "Load failed");
          setContactData(null);
        }
      } finally {
        if (!cancelled) setContactLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactOpen, contactId]);

  const openContactDetail = (id: string) => {
    setContactId(id);
    setContactOpen(true);
  };

  const contactEmails = useMemo(
    () => (contactData ? contactEmailList(contactData) : []),
    [contactData]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Contract details</DialogTitle>
          </DialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data && !loading && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">Customer</span>
                <br />
                <span className="font-medium">{data.customer?.name ?? "—"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Supplier</span>
                <br />
                <span className="font-medium">{data.supplier?.name ?? "—"}</span>
              </p>
              {data.mainContact?.name && (
                <p>
                  <span className="text-muted-foreground">Main contact</span>
                  <br />
                  {data.mainContact.id ? (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline text-left"
                      onClick={() => openContactDetail(data.mainContact!.id)}
                    >
                      {data.mainContact.name}
                    </button>
                  ) : (
                    <span className="font-medium">{data.mainContact.name}</span>
                  )}
                </p>
              )}
              <p>
                <span className="text-muted-foreground">Energy</span>
                <br />
                <span className="font-medium">
                  {(data.energyType ?? "").replaceAll("_", " ") || "—"}
                </span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <p>
                  <span className="text-muted-foreground">Start</span>
                  <br />
                  {fmtDate(data.startDate ?? undefined)}
                </p>
                <p>
                  <span className="text-muted-foreground">Expiration</span>
                  <br />
                  {fmtDate(data.expirationDate ?? undefined)}
                </p>
              </div>
              {data.pricePerUnit != null && String(data.pricePerUnit) !== "" && (
                <p>
                  <span className="text-muted-foreground">Price</span>
                  <br />
                  <span className="font-medium">
                    {String(data.pricePerUnit)} {data.priceUnit ?? ""}
                  </span>
                </p>
              )}
              {data.brokerMargin != null && String(data.brokerMargin) !== "" && (
                <p>
                  <span className="text-muted-foreground">Broker margin</span>
                  <br />
                  <span className="font-medium">
                    {String(data.brokerMargin)}{" "}
                    {(data.brokerMarginUnit ?? data.priceUnit ?? "").replaceAll("_", " ")}
                  </span>
                </p>
              )}
              {data.status && (
                <p className="text-xs text-muted-foreground capitalize">Status: {data.status}</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {contractId && (
              <Button type="button" variant="secondary" asChild>
                <Link href={`/directory/contracts?contractId=${encodeURIComponent(contractId)}`}>
                  Open in Contract Management
                </Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={contactOpen}
        onOpenChange={(o) => {
          setContactOpen(o);
          if (!o) {
            setContactId(null);
            setEmailComposeTo(null);
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Contact</DialogTitle>
          </DialogHeader>
          {contactLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {contactError && <p className="text-sm text-destructive">{contactError}</p>}
          {contactData && !contactLoading && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">Name</span>
                <br />
                <span className="font-medium">{contactData.name ?? "—"}</span>
              </p>
              {(contactData.company || contactData.jobTitle) && (
                <p>
                  <span className="text-muted-foreground">Company / title</span>
                  <br />
                  <span className="font-medium">
                    {[contactData.company, contactData.jobTitle].filter(Boolean).join(" · ") || "—"}
                  </span>
                </p>
              )}
              {contactData.label && (
                <p className="text-xs text-muted-foreground">Label: {contactData.label}</p>
              )}
              {contactEmails.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Email{contactEmails.length > 1 ? "s" : ""}</span>
                  <ul className="mt-1 space-y-1">
                    {contactEmails.map((row, i) => (
                      <li key={`${row.email}-${i}`}>
                        <button
                          type="button"
                          className="text-primary hover:underline break-all text-left"
                          onClick={() =>
                            setEmailComposeTo({
                              email: row.email,
                              name: contactData.name ?? undefined,
                            })
                          }
                        >
                          {row.email}
                        </button>
                        {row.type ? (
                          <span className="text-xs text-muted-foreground ml-1">({row.type})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {contactData.phone && (
                <p>
                  <span className="text-muted-foreground">Phone</span>
                  <br />
                  <a className="text-primary hover:underline" href={`tel:${contactData.phone}`}>
                    {contactData.phone}
                  </a>
                </p>
              )}
              {contactData.phones && contactData.phones.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Phones</span>
                  <ul className="mt-1 space-y-1">
                    {contactData.phones.map((row, i) => (
                      <li key={i}>
                        <a className="text-primary hover:underline" href={`tel:${row.phone}`}>
                          {row.phone}
                        </a>
                        {row.type ? <span className="text-xs text-muted-foreground ml-1">({row.type})</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {contactData.addresses && contactData.addresses.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Addresses</span>
                  <ul className="mt-1 space-y-2">
                    {contactData.addresses.map((a, i) => (
                      <li key={i} className="text-xs">
                        {[a.street, a.city, a.state, a.zip].filter(Boolean).join(", ")}
                        {a.type ? <span className="text-muted-foreground"> ({a.type})</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {contactData.website && (
                <p>
                  <span className="text-muted-foreground">Website</span>
                  <br />
                  <a
                    className="text-primary hover:underline break-all"
                    href={contactData.website.startsWith("http") ? contactData.website : `https://${contactData.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {contactData.website}
                  </a>
                </p>
              )}
              {contactData.notes && (
                <p>
                  <span className="text-muted-foreground">Notes</span>
                  <br />
                  <span className="whitespace-pre-wrap text-xs">{contactData.notes}</span>
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setContactOpen(false)}>
              Close
            </Button>
            {contactId && (
              <Button type="button" variant="secondary" asChild>
                <Link href="/communications/contacts">Open Contact Management</Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ComposeEmailModal
        to={emailComposeTo}
        onClose={() => setEmailComposeTo(null)}
        onSent={() => setEmailComposeTo(null)}
      />
    </>
  );
}
