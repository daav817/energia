"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  HelpCircle,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  Send,
  Table2,
  Upload,
  Trash2,
  Archive,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatUsPhoneDigits } from "@/lib/us-phone";
import {
  type RfpBillDriveItem,
  billDriveItemsFingerprintKey,
  normalizeRfpBillDriveItemsFromBody,
  normalizeRfpBillDriveItemsFromDb,
} from "@/lib/rfp-bill-drive-items";
import {
  ELECTRIC_PRICING_OPTION_DEFS,
  electricPricingFingerprintKey,
  emptyElectricPricingOptionsState,
  normalizeElectricPricingFromBody,
  normalizeElectricPricingFromDb,
  type ElectricPricingOptionId,
  type RfpElectricPricingOptionsState,
} from "@/lib/rfp-electric-pricing-options";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContactLabelsField } from "@/components/contact-labels-field";
import { formatContactLabels, parseContactLabels } from "@/lib/contact-labels";
import { loadBrokerProfile } from "@/lib/broker-profile";
import { googleOAuthConnectUrl, isGoogleReconnectSuggestedMessage } from "@/lib/google-connect";
import {
  buildRfpWorkflowNewRowPrefill,
  clearMemoryStagedContractPrefill,
  fetchRfpFromContractPrefillPayload,
  hasLocalContractPrefillPayload,
  peekContractPrefillFromContractStorage,
  seedContractPrefillPayload,
  type RfpFromContractPrefillPayload,
} from "@/lib/rfp-from-contract-prefill";
import { linkPendingWorkflowRowToRfp } from "@/lib/workflow-rfp-pending";
import {
  contactMatchesRfpEnergy,
  defaultRecipientSlotsForContacts,
  filterSupplierContactsForRfpEnergy,
  isRetiredSupplierContact,
  type RfpSupplierRecipientSlot,
} from "@/lib/supplier-rfp-contacts";
import {
  effectiveContactEmailFromRecord,
  isSupplierCandidateContact,
  normalizeCompanyKey,
} from "@/lib/customers-overview";
import { cn } from "@/lib/utils";
import { formatLocaleDateFromStoredDay } from "@/lib/calendar-date";
import { ContractRenewalEmailDialog } from "@/components/contracts/contract-renewal-email-dialog";
import { ComposeEmailModal, type ComposeEmailTarget } from "@/components/compose-email-modal";
import { useUnsavedNavigationBlock } from "@/components/unsaved-navigation-guard";
import { hydrateQuoteComparisonPicks } from "@/lib/quote-comparison-picks";
import type { QuoteWorkspaceSnapshotV1 } from "@/lib/quote-workspace-snapshot";

type EnergyType = "ELECTRIC" | "NATURAL_GAS";
type EnergyChoice = "" | EnergyType;
type PriceUnit = "KWH" | "MCF" | "CCF" | "DTH";
type RequestedTerm = "12" | "24" | "36" | "NYMEX";

type CustomerCompanyOption = {
  id: string;
  displayName: string;
  customerId: string | null;
  primaryContactId: string | null;
  contacts?: Array<{
    id: string;
    customerId: string | null;
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    email: string | null;
    phone: string | null;
    label: string | null;
  }>;
};

type SupplierOption = {
  id: string;
  name: string;
  email: string | null;
  isElectric: boolean;
  isNaturalGas: boolean;
  contactLinks?: Array<{
    id: string;
    name: string;
    email: string | null;
    /** From directory merge; all deliverable addresses for RFP. */
    emails?: string[];
    phone: string | null;
    isPriority: boolean;
    label: string | null;
    company: string | null;
  }>;
};

type AccountLineTiming = {
  utilityCycleId: string;
  sdiAccountNumber: string;
  lastMeterReadDate: string;
  nextScheduledReadDate: string;
  transitionType: string;
};

type AccountLine = {
  id: string;
  accountNumber: string;
  serviceAddress: string;
  annualUsage: string;
  avgMonthlyUsage: string;
  timing: AccountLineTiming;
};

const EMPTY_ACCOUNT_LINE_TIMING: AccountLineTiming = {
  utilityCycleId: "",
  sdiAccountNumber: "",
  lastMeterReadDate: "",
  nextScheduledReadDate: "",
  transitionType: "",
};

const ACCOUNT_TIMING_KEYS = [
  "utilityCycleId",
  "sdiAccountNumber",
  "lastMeterReadDate",
  "nextScheduledReadDate",
  "transitionType",
] as const satisfies readonly (keyof AccountLineTiming)[];

function timingFieldsFromRecord(o: unknown): Partial<AccountLineTiming> {
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const r = o as Record<string, unknown>;
  const out: Partial<AccountLineTiming> = {};
  for (const k of ACCOUNT_TIMING_KEYS) {
    if (typeof r[k] === "string") out[k] = r[k];
  }
  return out;
}

function legacyTopLevelTimingFromEnrollmentDetails(ed: Record<string, unknown>): Partial<AccountLineTiming> {
  const out: Partial<AccountLineTiming> = {};
  for (const k of ACCOUNT_TIMING_KEYS) {
    const v = ed[k];
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

function parseAccountTimingByIndexFromDetails(ed: Record<string, unknown>): Map<number, Partial<AccountLineTiming>> {
  const map = new Map<number, Partial<AccountLineTiming>>();
  const raw = ed.accountTimingByIndex;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const [key, val] of Object.entries(raw)) {
    const i = Number.parseInt(key, 10);
    if (!Number.isFinite(i) || i < 0) continue;
    const partial = timingFieldsFromRecord(val);
    if (Object.keys(partial).length > 0) map.set(i, partial);
  }
  return map;
}

function mergeAccountLineTiming(
  index: number,
  byIndex: Map<number, Partial<AccountLineTiming>>,
  legacyLine0: Partial<AccountLineTiming>
): AccountLineTiming {
  return {
    ...EMPTY_ACCOUNT_LINE_TIMING,
    ...(index === 0 ? legacyLine0 : {}),
    ...(byIndex.get(index) ?? {}),
  };
}

/** Normalize DB/API JSON: legacy contact id strings or { contactId, email } slots. */
function normalizeSupplierRecipientSelectionsFromApi(raw: unknown): Record<string, RfpSupplierRecipientSlot[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, RfpSupplierRecipientSlot[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const slots: RfpSupplierRecipientSlot[] = [];
    for (const item of v) {
      if (typeof item === "string") {
        const t = item.trim();
        if (t) slots.push({ contactId: t, email: "" });
      } else if (item && typeof item === "object" && item !== null && "contactId" in item) {
        const cid = String((item as { contactId: unknown }).contactId ?? "").trim();
        const em = String((item as { email?: unknown }).email ?? "").trim();
        if (cid) slots.push({ contactId: cid, email: em });
      }
    }
    if (slots.length > 0) out[k] = slots;
  }
  return out;
}

function supplierContactDeliverableEmails(contact: { email: string | null; emails?: string[] }): string[] {
  const list = contact.emails?.length ? contact.emails : contact.email ? [contact.email] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of list) {
    const t = (a || "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Drag handle between Quick checklist and Recent RFPs (same classes as dashboard resize handle). */
const RFP_CHECKLIST_RECENT_RESIZE_HANDLE_CLASS =
  "relative w-1.5 mx-0.5 rounded-sm bg-border/80 outline-none hover:bg-primary/40 data-[panel-group-direction=vertical]:h-1.5 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:my-0.5";

type DrivePickerKind = "bill" | "summary";

type DriveFileOption = {
  id: string;
  name: string;
  mimeType: string | null;
  webViewLink: string | null;
  modifiedTime: string | null;
  parents?: string[];
  isFolder?: boolean;
  size?: number | null;
  ownerName?: string | null;
};

type DriveBreadcrumb = {
  id: string;
  name: string;
};

function appendBillDriveItem(prev: RfpBillDriveItem[], item: RfpBillDriveItem): RfpBillDriveItem[] {
  const fid = item.fileId?.trim();
  let url = item.webViewLink.trim();
  if (!url && fid) url = `https://drive.google.com/file/d/${fid}/view`;
  if (!url && !fid) return prev;
  const normalized: RfpBillDriveItem = {
    webViewLink: url,
    ...(fid ? { fileId: fid } : {}),
    ...(item.filename?.trim() ? { filename: item.filename.trim() } : {}),
  };
  if (fid && prev.some((p) => p.fileId === fid)) return prev;
  const lk = url.toLowerCase();
  if (prev.some((p) => p.webViewLink.trim().toLowerCase() === lk)) return prev;
  return [...prev, normalized];
}

type SelectedDocumentKind = "bill" | "summary";

type EmailPreview = {
  subject: string;
  text: string;
  html: string;
  recipientPreview: Array<{
    supplierName: string;
    contactName: string;
    email: string;
  }>;
};

type RecentRfp = {
  id: string;
  status: string;
  energyType: EnergyType;
  requestedTerms: unknown;
  quoteDueDate: string | null;
  ldcUtility: string | null;
  sentAt?: string | null;
  parentRfpId?: string | null;
  refreshSequence?: number;
  quoteSummarySentAt?: string | null;
  archivedAt?: string | null;
  customer: { name: string; company: string | null } | null;
  customerContact?: {
    id: string;
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    email: string | null;
    company?: string | null;
  } | null;
  supplierContactSelections?: unknown;
  suppliers: Array<{ id: string; name: string; email?: string | null }>;
  accountLines: Array<{ accountNumber: string; annualUsage: string; avgMonthlyUsage: string }>;
  quoteComparisonPicks?: unknown;
};

/** Emails that received the original RFP send (from stored selections, with directory lookup for legacy rows). */
function collectSubmittedRfpSupplierFollowUpTargets(
  rfp: RecentRfp,
  suppliersList: SupplierOption[]
): ComposeEmailTarget[] {
  const et = rfp.energyType;
  const selections = normalizeSupplierRecipientSelectionsFromApi(rfp.supplierContactSelections);
  const supplierById = new Map(suppliersList.map((s) => [s.id, s]));
  const seenEmails = new Set<string>();
  const out: ComposeEmailTarget[] = [];

  const push = (email: string, name?: string) => {
    const em = email.trim();
    if (!em) return;
    const k = em.toLowerCase();
    if (seenEmails.has(k)) return;
    seenEmails.add(k);
    out.push(name?.trim() ? { email: em, name: name.trim() } : { email: em });
  };

  for (const [supplierId, slots] of Object.entries(selections)) {
    const supplier = supplierById.get(supplierId);
    const supplierName =
      supplier?.name ?? rfp.suppliers.find((s) => s.id === supplierId)?.name ?? "Supplier";
    const links = supplier?.contactLinks ?? [];
    const forEnergy = links.length ? filterSupplierContactsForRfpEnergy(links, et) : [];

    for (const slot of slots) {
      const contactRow = links.find((c) => c.id === slot.contactId);
      if (contactRow && isRetiredSupplierContact(contactRow.label)) continue;

      let email = (slot.email || "").trim();
      let contactName = "";
      const contact = forEnergy.find((c) => c.id === slot.contactId);
      if (contact) contactName = (contact.name || "").trim();
      if (!email && contact) {
        const delivered = supplierContactDeliverableEmails(contact);
        email = delivered[0] || "";
      }
      const label =
        contactName && supplierName ? `${contactName} — ${supplierName}` : supplierName;
      push(email, label);
    }
  }

  if (out.length === 0) {
    for (const s of rfp.suppliers) {
      const em = (s.email || "").trim();
      const supplierName = (s.name || "").trim() || "Supplier";
      if (em) push(em, supplierName);
    }
  }

  return out;
}

type CustomerContractRow = {
  id: string;
  energyType: string;
  expirationDate: string;
  isRecentExpired?: boolean;
  customer: { id: string; name: string; company: string | null };
  supplier: { name: string };
};

function contractExpirationKey(iso: string): string | null {
  const s = String(iso).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isPastContractExpiration(iso: string): boolean {
  const k = contractExpirationKey(iso);
  if (!k) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${k}T12:00:00`);
  return exp < today;
}

function rfpListCustomerTitle(rfp: RecentRfp): string {
  const company = (
    rfp.customer?.company?.trim() ||
    rfp.customer?.name?.trim() ||
    rfp.customerContact?.company?.trim() ||
    ""
  ).trim();
  const contact = (rfp.customerContact?.name || "").trim();
  if (company && contact) return `${company} — ${contact}`;
  if (company) return company;
  return contact || "Customer";
}

function rfpListCompanyLine(rfp: RecentRfp): string {
  return (
    rfp.customer?.company?.trim() ||
    rfp.customer?.name?.trim() ||
    rfp.customerContact?.company?.trim() ||
    ""
  ).trim() || "—";
}

function rfpContactPersonLine(rfp: RecentRfp): string {
  const c = rfp.customerContact;
  if (!c) return "—";
  const fn = (c.firstName && String(c.firstName).trim()) || "";
  const ln = (c.lastName && String(c.lastName).trim()) || "";
  const fromParts = [fn, ln].filter(Boolean).join(" ").trim();
  if (fromParts) return fromParts;
  return (c.name || "").trim() || "—";
}

function formatCustomerContactSelectLine(c: {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string | null;
}): string {
  const fn = (c.firstName && String(c.firstName).trim()) || "";
  const ln = (c.lastName && String(c.lastName).trim()) || "";
  const person = [fn, ln].filter(Boolean).join(" ").trim() || (c.name && c.name.trim()) || "Contact";
  const em = c.email ? ` — ${c.email}` : "";
  return `${person}${em}`;
}

function defaultCustomerContactLabels(energy: EnergyChoice): string {
  const parts: string[] = ["customer"];
  if (energy === "NATURAL_GAS") parts.push("gas");
  if (energy === "ELECTRIC") parts.push("electric");
  return formatContactLabels(parts);
}

const RFP_WIP_STORAGE_KEY = "energia-rfp-wip-v6";

const TERM_OPTIONS: RequestedTerm[] = ["12", "24", "36", "NYMEX"];

const TRANSITION_TYPE_OPTIONS: { value: string; label: string; help: string }[] = [
  {
    value: "Start on Flow (Standard)",
    label: "Start on Flow (Standard)",
    help: "Most efficient. Tells the supplier to drop the enrollment into the very next available window.",
  },
  {
    value: "Date-Certain / Fixed Month",
    label: "Date-Certain / Fixed Month",
    help: '"I want this to start specifically in October." Use this for clients who want to align with a fiscal year.',
  },
  {
    value: "Seamless Renewal (Direct-to-Direct)",
    label: "Seamless Renewal (Direct-to-Direct)",
    help: 'Use this when the client is currently with a 3rd party supplier. It signals that the new supplier needs to time their "814 Enrollment" to "knock out" the old supplier\'s rate exactly on the meter read day.',
  },
  {
    value: "Drop to Default (Bridge)",
    label: "Drop to Default (Bridge)",
    help: 'Use this if the current supplier\'s "holdover" rate is a rip-off. You tell the new supplier to wait one month while the customer "rests" on the utility\'s default rate.',
  },
];
const UTILITY_OPTIONS = [
  "AEP Ohio",
  "AES Ohio",
  "CenterPoint Energy",
  "Columbia Gas",
  "Consumers Energy",
  "DTE Energy",
  "Duke Energy Ohio",
  "Dominion Energy Ohio",
  "FirstEnergy Ohio Edison",
  "FirstEnergy Toledo Edison",
  "National Fuel",
  "NIPSCO",
  "Nicor Gas",
  "Peoples Gas",
];

const emptyAccountLine = (): AccountLine => ({
  id: crypto.randomUUID(),
  accountNumber: "",
  serviceAddress: "",
  annualUsage: "",
  avgMonthlyUsage: "",
  timing: { ...EMPTY_ACCOUNT_LINE_TIMING },
});

const emptyCustomerDraft = {
  customerName: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  contactLabel: "",
};

function validateCustomTermsInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      return `Invalid custom term "${p}" — use whole numbers separated by commas (e.g. 18, 30).`;
    }
    const n = Number.parseInt(p, 10);
    if (n <= 0) return "Custom term months must be positive integers.";
  }
  return null;
}

function mapDbTermsToRequestedTerms(rt: unknown): RequestedTerm[] {
  const out: RequestedTerm[] = [];
  if (!Array.isArray(rt)) return ["12", "24", "36"];
  for (const entry of rt) {
    const e = entry as { kind?: string; months?: number };
    if (e?.kind === "nymex") out.push("NYMEX");
    if (e?.kind === "months" && typeof e.months === "number") {
      const m = e.months;
      if (m === 12 || m === 24 || m === 36) out.push(String(m) as RequestedTerm);
    }
  }
  return out.length ? [...new Set(out)] : ["12", "24", "36"];
}

function mapDbTermsToCustomMonthsString(rt: unknown): string {
  if (!Array.isArray(rt)) return "";
  const nums: number[] = [];
  for (const entry of rt) {
    const e = entry as { kind?: string; months?: number };
    if (e?.kind === "months" && typeof e.months === "number") {
      const m = e.months;
      if (m !== 12 && m !== 24 && m !== 36) nums.push(m);
    }
  }
  return [...new Set(nums)].sort((a, b) => a - b).join(", ");
}

type RfpFormFingerprintInput = {
  customerCompanyId: string;
  customerContactId: string;
  energyType: EnergyChoice;
  selectedSupplierIds: string[];
  selectedSupplierRecipients: Record<string, RfpSupplierRecipientSlot[]>;
  requestedTerms: RequestedTerm[];
  customTermMonths: string;
  contractStartValue: string;
  quoteDueDate: string;
  billDriveItemsKey: string;
  summarySpreadsheetUrl: string;
  ldcUtility: string;
  brokerMargin: string;
  brokerMarginUnit: PriceUnit;
  notes: string;
  accountLines: AccountLine[];
  selectedSummaryDriveFileId: string;
  electricPricingKey: string;
  reissueParentRfpId: string | null;
};

function computeRfpFingerprint(input: RfpFormFingerprintInput): string {
  const supplierIds = [...input.selectedSupplierIds].sort();
  const recipientSupplierKeys = Object.keys(input.selectedSupplierRecipients).sort();
  const recipientPick: Record<string, string[]> = {};
  for (const k of recipientSupplierKeys) {
    const v = input.selectedSupplierRecipients[k];
    recipientPick[k] = Array.isArray(v)
      ? [...v]
          .map((s) => `${String(s.contactId)}\0${String(s.email).trim().toLowerCase()}`)
          .sort()
      : [];
  }
  const accounts = input.accountLines.map((line) => ({
    accountNumber: line.accountNumber.trim(),
    serviceAddress: (line.serviceAddress ?? "").trim(),
    annualUsage: line.annualUsage.trim(),
    avgMonthlyUsage: line.avgMonthlyUsage.trim(),
    timing: {
      utilityCycleId: line.timing.utilityCycleId.trim(),
      sdiAccountNumber: line.timing.sdiAccountNumber.trim(),
      lastMeterReadDate: line.timing.lastMeterReadDate.trim(),
      nextScheduledReadDate: line.timing.nextScheduledReadDate.trim(),
      transitionType: line.timing.transitionType.trim(),
    },
  }));
  return JSON.stringify({
    customerCompanyId: input.customerCompanyId,
    customerContactId: input.customerContactId,
    energyType: input.energyType,
    supplierIds,
    supplierRecipientSlots: recipientPick,
    requestedTerms: [...input.requestedTerms].sort(),
    customTermMonths: input.customTermMonths.trim(),
    contractStartValue: input.contractStartValue,
    quoteDueDate: input.quoteDueDate,
    billDriveItemsKey: input.billDriveItemsKey,
    summarySpreadsheetUrl: input.summarySpreadsheetUrl.trim(),
    ldcUtility: input.ldcUtility.trim(),
    brokerMargin: input.brokerMargin.trim(),
    brokerMarginUnit: input.brokerMarginUnit,
    notes: input.notes.trim(),
    accounts,
    selectedSummaryDriveFileId: input.selectedSummaryDriveFileId,
    electricPricingKey: input.electricPricingKey,
    reissueParentRfpId: input.reissueParentRfpId,
  });
}

type LoadedRfpCustomerPayload = {
  customerId?: string | null;
  customerContactId?: string | null;
  customer?: { name?: string | null; company?: string | null } | null;
  customerContact?: {
    id?: string;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    emails?: Array<{ email?: string | null }> | null;
    phone?: string | null;
    company?: string | null;
    label?: string | null;
    customerId?: string | null;
  } | null;
};

function resolvedLoadedRfpCustomerContactId(data: LoadedRfpCustomerPayload): string {
  return (
    (data.customerContactId && String(data.customerContactId).trim()) ||
    (data.customerContact?.id && String(data.customerContact.id).trim()) ||
    ""
  );
}

type LoadedRfpApiResponse = LoadedRfpCustomerPayload & {
  error?: string;
  energyType?: string;
  requestedTerms?: unknown;
  contractStartYear?: number | null;
  contractStartMonth?: number | null;
  quoteDueDate?: string | null;
  googleDriveFolderUrl?: string | null;
  billDriveItems?: unknown;
  electricPricingOptions?: unknown;
  summarySpreadsheetUrl?: string | null;
  ldcUtility?: string | null;
  brokerMargin?: unknown;
  brokerMarginUnit?: string;
  notes?: string | null;
  enrollmentDetails?: unknown;
  accountLines?: Array<{
    accountNumber: string;
    serviceAddress?: string | null;
    annualUsage: unknown;
    avgMonthlyUsage: unknown;
  }>;
  supplierContactSelections?: unknown;
  status?: string;
  id?: string;
  suppliers?: Array<{ id: string }>;
};

function buildEnrollmentDetailsPayload(lines: AccountLine[]): Record<string, unknown> | null {
  const o: Record<string, unknown> = {};
  const timingMap: Record<string, AccountLineTiming> = {};
  lines.forEach((line, i) => {
    const t = line.timing;
    const hasAny =
      t.utilityCycleId.trim() ||
      t.sdiAccountNumber.trim() ||
      t.lastMeterReadDate.trim() ||
      t.nextScheduledReadDate.trim() ||
      t.transitionType.trim();
    if (hasAny) timingMap[String(i)] = { ...t };
  });
  if (Object.keys(timingMap).length > 0) o.accountTimingByIndex = timingMap;
  return Object.keys(o).length > 0 ? o : null;
}

function hydrateAccountLinesFromRfpApi(
  apiLines: LoadedRfpApiResponse["accountLines"],
  ed: Record<string, unknown> | null
): AccountLine[] {
  const byIndex = ed ? parseAccountTimingByIndexFromDetails(ed) : new Map<number, Partial<AccountLineTiming>>();
  const legacyLine0 = ed ? legacyTopLevelTimingFromEnrollmentDetails(ed) : {};
  if (Array.isArray(apiLines) && apiLines.length > 0) {
    return apiLines.map((line, i) => ({
      id: crypto.randomUUID(),
      accountNumber: String(line.accountNumber ?? ""),
      serviceAddress: String(line.serviceAddress ?? ""),
      annualUsage: String(line.annualUsage ?? ""),
      avgMonthlyUsage: String(line.avgMonthlyUsage ?? ""),
      timing: mergeAccountLineTiming(i, byIndex, legacyLine0),
    }));
  }
  return [
    {
      id: crypto.randomUUID(),
      accountNumber: "",
      serviceAddress: "",
      annualUsage: "",
      avgMonthlyUsage: "",
      timing: mergeAccountLineTiming(0, byIndex, legacyLine0),
    },
  ];
}

function fingerprintFromLoadedRfp(data: LoadedRfpApiResponse, customerCompanyRowId: string): string {
  const contactId = resolvedLoadedRfpCustomerContactId(data);
  const supIds = Array.isArray(data.suppliers) ? data.suppliers.map((s: { id: string }) => s.id) : [];
  const selections = normalizeSupplierRecipientSelectionsFromApi(data.supplierContactSelections);
  const edObj =
    data.enrollmentDetails && typeof data.enrollmentDetails === "object" && !Array.isArray(data.enrollmentDetails)
      ? (data.enrollmentDetails as Record<string, unknown>)
      : null;
  const byIndex = edObj ? parseAccountTimingByIndexFromDetails(edObj) : new Map<number, Partial<AccountLineTiming>>();
  const legacyLine0 = edObj ? legacyTopLevelTimingFromEnrollmentDetails(edObj) : {};
  const emptyLine: AccountLine = {
    id: "",
    accountNumber: "",
    serviceAddress: "",
    annualUsage: "",
    avgMonthlyUsage: "",
    timing: mergeAccountLineTiming(0, byIndex, legacyLine0),
  };
  const lines =
    Array.isArray(data.accountLines) && data.accountLines.length > 0
      ? data.accountLines.map(
          (
            line: {
              accountNumber: string;
              serviceAddress?: string | null;
              annualUsage: unknown;
              avgMonthlyUsage: unknown;
            },
            i: number
          ) => ({
            id: "loaded",
            accountNumber: line.accountNumber ?? "",
            serviceAddress: line.serviceAddress ?? "",
            annualUsage: String(line.annualUsage ?? ""),
            avgMonthlyUsage: String(line.avgMonthlyUsage ?? ""),
            timing: mergeAccountLineTiming(i, byIndex, legacyLine0),
          })
        )
      : [emptyLine];
  const et: EnergyChoice =
    data.energyType === "ELECTRIC" || data.energyType === "NATURAL_GAS" ? data.energyType : "";
  const reissue =
    data.status === "draft"
      ? null
      : data.id && String(data.id).trim()
        ? String(data.id).trim()
        : null;

  let billItems = normalizeRfpBillDriveItemsFromDb(data.billDriveItems);
  if (billItems.length === 0 && data.googleDriveFolderUrl) {
    const u = String(data.googleDriveFolderUrl).trim();
    if (u) billItems = [{ webViewLink: u }];
  }

  const ep =
    et === "ELECTRIC" ? normalizeElectricPricingFromDb(data.electricPricingOptions, "ELECTRIC") : null;

  return computeRfpFingerprint({
    customerCompanyId: customerCompanyRowId,
    customerContactId: contactId,
    energyType: et,
    selectedSupplierIds: supIds,
    selectedSupplierRecipients: selections,
    requestedTerms: mapDbTermsToRequestedTerms(data.requestedTerms),
    customTermMonths: mapDbTermsToCustomMonthsString(data.requestedTerms),
    contractStartValue:
      data.contractStartYear && data.contractStartMonth
        ? `${String(data.contractStartYear).padStart(4, "0")}-${String(data.contractStartMonth).padStart(2, "0")}`
        : "",
    quoteDueDate: data.quoteDueDate ? String(data.quoteDueDate).slice(0, 10) : "",
    billDriveItemsKey: billDriveItemsFingerprintKey(billItems),
    summarySpreadsheetUrl: data.summarySpreadsheetUrl || "",
    ldcUtility: data.ldcUtility || "",
    brokerMargin: data.brokerMargin != null ? String(data.brokerMargin) : "",
    brokerMarginUnit:
      data.brokerMarginUnit === "KWH" ||
      data.brokerMarginUnit === "MCF" ||
      data.brokerMarginUnit === "CCF" ||
      data.brokerMarginUnit === "DTH"
        ? data.brokerMarginUnit
        : "MCF",
    notes: data.notes || "",
    accountLines: lines,
    selectedSummaryDriveFileId: "",
    electricPricingKey: electricPricingFingerprintKey(ep),
    reissueParentRfpId: reissue,
  });
}

function normalizeCustomerCompaniesPayload(raw: unknown): CustomerCompanyOption[] {
  const arr = Array.isArray((raw as { companies?: unknown })?.companies)
    ? (raw as { companies: CustomerCompanyOption[] }).companies
    : [];
  return arr.filter((c) => {
    const n = String(c.displayName ?? "").trim();
    return n !== "." && n !== "";
  });
}

/** Match saved RFP to a customer-companies row using DB ids and normalized company names. */
function resolveSavedRfpCompanyRow(
  companies: CustomerCompanyOption[],
  data: LoadedRfpCustomerPayload
): CustomerCompanyOption | null {
  const cid = data.customerId && String(data.customerId).trim() ? String(data.customerId).trim() : "";
  if (cid) {
    const byCust = companies.find((c) => c.customerId === cid);
    if (byCust) return byCust;
  }
  const contactId = resolvedLoadedRfpCustomerContactId(data);
  if (contactId) {
    const byContact = companies.find((c) => c.contacts?.some((ct) => ct.id === contactId));
    if (byContact) return byContact;
  }
  const nameKeys = [data.customer?.company, data.customer?.name]
    .map((s) => normalizeCompanyKey(String(s ?? "")))
    .filter(Boolean);
  for (const key of nameKeys) {
    const hit = companies.find((c) => normalizeCompanyKey(c.displayName) === key);
    if (hit) return hit;
  }
  const contactCo = data.customerContact?.company
    ? normalizeCompanyKey(String(data.customerContact.company))
    : "";
  if (contactCo) {
    const hit = companies.find((c) => normalizeCompanyKey(c.displayName) === contactCo);
    if (hit) return hit;
  }
  return null;
}

/** Match contract→RFP prefill to a customer-companies bucket (same rules as opening a saved RFP). */
function resolveContractPrefillCompanyRow(
  companies: CustomerCompanyOption[],
  payload: RfpFromContractPrefillPayload
): CustomerCompanyOption | null {
  const stub: LoadedRfpCustomerPayload = {
    customerId: payload.customerId,
    customerContactId: payload.customerContactId,
    customer: {
      company: payload.contractCustomerCompany.trim() || null,
      name: payload.contractCustomerName.trim() || null,
    },
    customerContact: payload.mainContactCompany.trim()
      ? { company: payload.mainContactCompany.trim() }
      : null,
  };
  return resolveSavedRfpCompanyRow(companies, stub);
}

export default function RfpGeneratorPage() {
  const router = useRouter();
  const [customerCompanies, setCustomerCompanies] = useState<CustomerCompanyOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [recentRfqs, setRecentRfqs] = useState<RecentRfp[]>([]);
  const [archivedRfqs, setArchivedRfqs] = useState<RecentRfp[]>([]);
  const [recentUnsubmittedExpanded, setRecentUnsubmittedExpanded] = useState(true);
  const [recentSubmittedExpanded, setRecentSubmittedExpanded] = useState(true);
  const [recentArchivedExpanded, setRecentArchivedExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [baselineFingerprint, setBaselineFingerprint] = useState<string | null>(null);
  const [renewalEmailContractId, setRenewalEmailContractId] = useState<string | null>(null);
  const [customerContractsReminder, setCustomerContractsReminder] = useState<CustomerContractRow[]>([]);
  const [customerContractsReminderLoading, setCustomerContractsReminderLoading] = useState(false);
  const [refreshSupplierModalRfp, setRefreshSupplierModalRfp] = useState<RecentRfp | null>(null);
  const [rfpFollowUpCompose, setRfpFollowUpCompose] = useState<ComposeEmailTarget[] | null>(null);
  const [refreshSupplierQuoteDueDate, setRefreshSupplierQuoteDueDate] = useState("");
  const [refreshSupplierSending, setRefreshSupplierSending] = useState(false);
  const [supplierDirectoryRefreshing, setSupplierDirectoryRefreshing] = useState(false);
  const [supplierContactPrimarySavingId, setSupplierContactPrimarySavingId] = useState<string | null>(null);
  const [supplierSelectHelpOpen, setSupplierSelectHelpOpen] = useState(false);

  const [customerCompanyId, setCustomerCompanyId] = useState("");
  const [customerCompanySearch, setCustomerCompanySearch] = useState("");
  const [customerCompanyDropdownOpen, setCustomerCompanyDropdownOpen] = useState(false);
  const [customerContactId, setCustomerContactId] = useState("");
  /** When API contact is missing from /customer-companies bucket, keep Select working after Continue Editing. */
  const [rfpExtraCustomerContact, setRfpExtraCustomerContact] = useState<
    NonNullable<CustomerCompanyOption["contacts"]>[number] | null
  >(null);
  const [energyType, setEnergyType] = useState<EnergyChoice>("");
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [selectedSupplierRecipients, setSelectedSupplierRecipients] = useState<
    Record<string, RfpSupplierRecipientSlot[]>
  >({});
  const [supplierRfpEmailDialog, setSupplierRfpEmailDialog] = useState<string[] | null>(null);
  const [requestedTerms, setRequestedTerms] = useState<RequestedTerm[]>(["12", "24", "36"]);
  const [meterModalOpen, setMeterModalOpen] = useState(false);
  const [meterUtility, setMeterUtility] = useState<"AEP" | "DUKE" | "FIRSTENERGY" | "COLUMBIA">("AEP");
  const [meterAccount, setMeterAccount] = useState("");
  const [meterLoading, setMeterLoading] = useState(false);
  const [meterRows, setMeterRows] = useState<{ monthKey: string; readDate: string; label: string }[]>([]);
  const [meterNotice, setMeterNotice] = useState("");
  const [accountTimingModalLineId, setAccountTimingModalLineId] = useState<string | null>(null);
  const [customTermMonths, setCustomTermMonths] = useState("");
  const [contractStartValue, setContractStartValue] = useState("");
  const [quoteDueDate, setQuoteDueDate] = useState("");
  const [billDriveItems, setBillDriveItems] = useState<RfpBillDriveItem[]>([]);
  const [summarySpreadsheetUrl, setSummarySpreadsheetUrl] = useState("");
  const [ldcUtility, setLdcUtility] = useState("");
  const [ldcUtilitySearch, setLdcUtilitySearch] = useState("");
  const [ldcUtilityDropdownOpen, setLdcUtilityDropdownOpen] = useState(false);
  const [brokerMargin, setBrokerMargin] = useState("");
  const [brokerMarginUnit, setBrokerMarginUnit] = useState<PriceUnit>("MCF");
  const [electricPricing, setElectricPricing] = useState<RfpElectricPricingOptionsState>(() =>
    emptyElectricPricingOptionsState()
  );
  const [notes, setNotes] = useState("");
  const [accountLines, setAccountLines] = useState<AccountLine[]>([emptyAccountLine()]);
  const [marginCalculatorOpen, setMarginCalculatorOpen] = useState(false);
  const [calculatorMargin, setCalculatorMargin] = useState("");
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [drivePickerKind, setDrivePickerKind] = useState<DrivePickerKind>("bill");
  const [drivePickerQuery, setDrivePickerQuery] = useState("");
  const [drivePickerLoading, setDrivePickerLoading] = useState(false);
  const [drivePickerError, setDrivePickerError] = useState("");
  const [driveShareWorking, setDriveShareWorking] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileOption[]>([]);
  const [driveBreadcrumbs, setDriveBreadcrumbs] = useState<DriveBreadcrumb[]>([]);
  const [driveCurrentFolderId, setDriveCurrentFolderId] = useState("");
  const [driveSort, setDriveSort] = useState<"name" | "modified" | "size">("name");
  const [localBillFile, setLocalBillFile] = useState<File | null>(null);
  const [localSummaryFile, setLocalSummaryFile] = useState<File | null>(null);
  const [selectedSummaryDriveFileId, setSelectedSummaryDriveFileId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<EmailPreview | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);

  const [sending, setSending] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [reissueParentRfpId, setReissueParentRfpId] = useState<string | null>(null);
  const [contactRecordCustomerId, setContactRecordCustomerId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [customerRfpLoadedBanner, setCustomerRfpLoadedBanner] = useState<"hidden" | "visible" | "fading">("hidden");
  const customerRfpLoadedTimersRef = useRef<{
    toFade?: ReturnType<typeof setTimeout>;
    toHide?: ReturnType<typeof setTimeout>;
  }>({});
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [deleteRfpTarget, setDeleteRfpTarget] = useState<{ id: string; title: string } | null>(null);
  const [recentRfpArchiveTarget, setRecentRfpArchiveTarget] = useState<RecentRfp | null>(null);
  const [recentRfpArchiveBusy, setRecentRfpArchiveBusy] = useState(false);
  const [deleteRfpLoading, setDeleteRfpLoading] = useState(false);
  const [utilityTableModalOpen, setUtilityTableModalOpen] = useState(false);
  const [customTermsError, setCustomTermsError] = useState("");
  const [testEmailFoundId, setTestEmailFoundId] = useState<string | null>(null);
  const [testEmailViewOpen, setTestEmailViewOpen] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    sentTo?: number;
    emailRecipientCount?: number;
    testEmailSent?: boolean;
    markedSentOutside?: boolean;
    error?: string;
  } | null>(null);

  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(emptyCustomerDraft);
  const [focusRfpId, setFocusRfpId] = useState("");
  const [attachContactCustomerId, setAttachContactCustomerId] = useState<string | null>(null);
  const [contactLabelPresets, setContactLabelPresets] = useState<string[]>([]);
  const [rfpTestEmailOk, setRfpTestEmailOk] = useState(false);
  const [markSentOutsideRfpId, setMarkSentOutsideRfpId] = useState<string | null>(null);
  const [markSentOutsideBusy, setMarkSentOutsideBusy] = useState(false);
  const localBillInputRef = useRef<HTMLInputElement>(null);
  const localSummaryInputRef = useRef<HTMLInputElement>(null);
  const customerCompanyInputRef = useRef<HTMLInputElement>(null);
  const ldcUtilityInputRef = useRef<HTMLInputElement>(null);
  const skipNextWipPersist = useRef(false);
  /** Skip one company↔contact sync after hydrating a saved RFP so useEffect does not wipe loaded contact. */
  const suppressContactCompanySyncRef = useRef(false);
  const skipNextSupplierInclusionDefaultRef = useRef(false);
  const lastEnergyForSuppliersRef = useRef<EnergyChoice>("");
  /** Dedupes contract→RFP prefill apply; cleared on unmount so React Strict Mode reapplies. */
  const contractPrefillAppliedKeyRef = useRef<string | null>(null);
  const [contractPrefillHydrateTick, setContractPrefillHydrateTick] = useState(0);
  /** After contract prefill, skip auto-setting broker margin unit from energy type so contract priceUnit wins. */
  const skipNextBrokerMarginUnitDefaultRef = useRef(false);
  /** Contract→RFP prefill may include supplier ids before `eligibleSuppliers` is ready. */
  const contractPrefillSupplierIdsRef = useRef<string[] | null>(null);
  const contractPrefillSuppliersAppliedRef = useRef(false);

  useEffect(() => {
    void loadPageData();
  }, []);

  useEffect(() => {
    return () => {
      contractPrefillAppliedKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("fromContract") !== "1") return;
    if (hasLocalContractPrefillPayload()) return;
    const cid = u.searchParams.get("prefillContractId")?.trim();
    const pc = u.searchParams.get("prefillCustomerId")?.trim();
    const pe = u.searchParams.get("prefillEnergy");
    const wid = u.searchParams.get("workflowRowId")?.trim();
    let cancelled = false;
    void (async () => {
      if (cid) {
        const p = await fetchRfpFromContractPrefillPayload(cid);
        if (cancelled || !p) return;
        seedContractPrefillPayload(p);
        setContractPrefillHydrateTick((t) => t + 1);
        return;
      }
      if (
        pc &&
        (pe === "ELECTRIC" || pe === "NATURAL_GAS") &&
        wid
      ) {
        const p = await buildRfpWorkflowNewRowPrefill({
          workflowRowId: wid,
          customerId: pc,
          energyType: pe,
        });
        if (cancelled || !p) return;
        seedContractPrefillPayload(p);
        setContractPrefillHydrateTick((t) => t + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!refreshSupplierModalRfp) {
      setRefreshSupplierQuoteDueDate("");
      return;
    }
    const d = refreshSupplierModalRfp.quoteDueDate;
    setRefreshSupplierQuoteDueDate(d ? String(d).slice(0, 10) : "");
  }, [refreshSupplierModalRfp]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const em = loadBrokerProfile().email.trim();
    if (!em) return;
    setTestEmail((prev) => (prev.trim() === "" ? em : prev));
  }, []);

  useEffect(() => {
    setLdcUtilitySearch(ldcUtility);
  }, [ldcUtility]);

  useEffect(() => {
    if (accountTimingModalLineId && !accountLines.some((l) => l.id === accountTimingModalLineId)) {
      setAccountTimingModalLineId(null);
    }
  }, [accountLines, accountTimingModalLineId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(RFP_WIP_STORAGE_KEY);
      if (!raw || skipNextWipPersist.current) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (
        data.version !== 2 &&
        data.version !== 3 &&
        data.version !== 4 &&
        data.version !== 5 &&
        data.version !== 6 &&
        data.version !== 7 &&
        data.version !== 8
      )
        return;
      if (typeof data.customerCompanyId === "string") setCustomerCompanyId(data.customerCompanyId);
      if (typeof data.customerContactId === "string") setCustomerContactId(data.customerContactId);
      if (data.energyType === "ELECTRIC" || data.energyType === "NATURAL_GAS") setEnergyType(data.energyType);
      if (Array.isArray(data.selectedSupplierIds)) setSelectedSupplierIds(data.selectedSupplierIds.map(String));
      if (data.selectedSupplierRecipients && typeof data.selectedSupplierRecipients === "object") {
        setSelectedSupplierRecipients(
          normalizeSupplierRecipientSelectionsFromApi(data.selectedSupplierRecipients)
        );
      } else if (data.selectedSupplierContactIds && typeof data.selectedSupplierContactIds === "object") {
        setSelectedSupplierRecipients(
          normalizeSupplierRecipientSelectionsFromApi(data.selectedSupplierContactIds)
        );
      }
      if (Array.isArray(data.requestedTerms)) setRequestedTerms(data.requestedTerms as RequestedTerm[]);
      if (typeof data.customTermMonths === "string") setCustomTermMonths(data.customTermMonths);
      if (typeof data.contractStartValue === "string") setContractStartValue(data.contractStartValue);
      if (typeof data.quoteDueDate === "string") setQuoteDueDate(data.quoteDueDate);
      const fromSavedBills =
        (data.version === 7 || data.version === 8) && Array.isArray(data.billDriveItems)
          ? normalizeRfpBillDriveItemsFromDb(data.billDriveItems)
          : [];
      const fromLegacy = normalizeRfpBillDriveItemsFromBody({
        googleDriveFolderUrl: typeof data.googleDriveFolderUrl === "string" ? data.googleDriveFolderUrl : "",
        billDriveFileId: typeof data.selectedBillDriveFileId === "string" ? data.selectedBillDriveFileId : "",
      });
      setBillDriveItems(fromSavedBills.length > 0 ? fromSavedBills : fromLegacy);
      if (data.energyType === "ELECTRIC") {
        setElectricPricing(
          normalizeElectricPricingFromBody(
            { electricPricingOptions: data.electricPricing } as Record<string, unknown>,
            "ELECTRIC"
          ) ?? emptyElectricPricingOptionsState()
        );
      }
      if (typeof data.summarySpreadsheetUrl === "string") setSummarySpreadsheetUrl(data.summarySpreadsheetUrl);
      if (typeof data.ldcUtility === "string") setLdcUtility(data.ldcUtility);
      if (typeof data.brokerMargin === "string") setBrokerMargin(data.brokerMargin);
      if (data.brokerMarginUnit === "KWH" || data.brokerMarginUnit === "MCF" || data.brokerMarginUnit === "CCF" || data.brokerMarginUnit === "DTH") {
        setBrokerMarginUnit(data.brokerMarginUnit);
      }
      if (typeof data.notes === "string") setNotes(data.notes);
      if (Array.isArray(data.accountLines)) {
        const legacyEnrollment =
          data.version === 3 && data.enrollment && typeof data.enrollment === "object"
            ? legacyTopLevelTimingFromEnrollmentDetails(data.enrollment as Record<string, unknown>)
            : {};
        setAccountLines(
          (data.accountLines as AccountLine[]).map((line, i) => {
            const fromLine =
              line.timing && typeof line.timing === "object"
                ? timingFieldsFromRecord(line.timing)
                : {};
            return {
              ...line,
              id: line.id || crypto.randomUUID(),
              timing: {
                ...EMPTY_ACCOUNT_LINE_TIMING,
                ...(data.version === 3 && i === 0 ? legacyEnrollment : {}),
                ...fromLine,
              },
            };
          })
        );
      }
      if (typeof data.selectedSummaryDriveFileId === "string") setSelectedSummaryDriveFileId(data.selectedSummaryDriveFileId);
      if (typeof data.activeDraftId === "string") setActiveDraftId(data.activeDraftId);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return;
    const t = window.setTimeout(() => {
      if (skipNextWipPersist.current) {
        skipNextWipPersist.current = false;
        return;
      }
      localStorage.setItem(
        RFP_WIP_STORAGE_KEY,
        JSON.stringify({
          version: 8,
          customerCompanyId,
          customerContactId,
          energyType,
          selectedSupplierIds,
          selectedSupplierRecipients,
          requestedTerms,
          customTermMonths,
          contractStartValue,
          quoteDueDate,
          billDriveItems,
          electricPricing: energyType === "ELECTRIC" ? electricPricing : undefined,
          summarySpreadsheetUrl,
          ldcUtility,
          brokerMargin,
          brokerMarginUnit,
          notes,
          accountLines,
          selectedSummaryDriveFileId,
          activeDraftId,
        })
      );
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    loading,
    customerCompanyId,
    customerContactId,
    energyType,
    selectedSupplierIds,
    selectedSupplierRecipients,
    requestedTerms,
    customTermMonths,
    contractStartValue,
    quoteDueDate,
    billDriveItems,
    summarySpreadsheetUrl,
    ldcUtility,
    brokerMargin,
    brokerMarginUnit,
    electricPricing,
    energyType,
    notes,
    accountLines,
    selectedSummaryDriveFileId,
    activeDraftId,
  ]);

  useEffect(() => {
    if (!rfpTestEmailOk || testEmailFoundId) return;
    const started = Date.now();
    const iv = window.setInterval(() => {
      if (Date.now() - started > 120_000) {
        window.clearInterval(iv);
        return;
      }
      void (async () => {
        try {
          const q = encodeURIComponent("subject:[TEST]");
          const r = await fetch(`/api/emails?maxResults=30&labelIds=INBOX&q=${q}`);
          const data = await r.json();
          const msgs = Array.isArray(data?.messages) ? data.messages : [];
          const hit = msgs.find(
            (m: { subject?: string }) => typeof m?.subject === "string" && m.subject.toLowerCase().includes("[test]")
          ) as { id: string } | undefined;
          if (hit?.id) {
            setTestEmailFoundId(hit.id);
            window.clearInterval(iv);
          }
        } catch {
          /* ignore */
        }
      })();
    }, 3000);
    return () => window.clearInterval(iv);
  }, [rfpTestEmailOk, testEmailFoundId]);

  useEffect(() => {
    void fetch("/api/contacts/label-options")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.labels)) setContactLabelPresets(data.labels as string[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setRfpTestEmailOk(false);
  }, [customerCompanyId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URL(window.location.href).searchParams.get("rfpRequestId") || "";
    setFocusRfpId(fromUrl);
    const openForEdit = new URL(window.location.href).searchParams.get("openForEdit") === "1";
    if (fromUrl && openForEdit) {
      void loadSavedRfpIntoForm(fromUrl);
      const u = new URL(window.location.href);
      u.searchParams.delete("openForEdit");
      window.history.replaceState({}, "", u.pathname + u.search);
    }
  }, []);

  useEffect(() => {
    return () => {
      const t = customerRfpLoadedTimersRef.current;
      if (t.toFade) clearTimeout(t.toFade);
      if (t.toHide) clearTimeout(t.toHide);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || loading || customerCompanies.length === 0) return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("fromContract") !== "1") return;

    const payload = peekContractPrefillFromContractStorage();
    if (!payload) return;

    const nonce = u.searchParams.get("prefillNonce") || "";
    const dedupeKey = `${payload.sourceContractId}:${nonce}`;
    if (contractPrefillAppliedKeyRef.current === dedupeKey) return;

    const companyRow = resolveContractPrefillCompanyRow(customerCompanies, payload);
    if (!companyRow) {
      clearMemoryStagedContractPrefill();
      setDraftNotice(
        "Could not match this contract’s customer to the Customer Company list built from your Contacts. Ensure a customer-tagged contact uses the same company name as on the contract (or open the RFP and pick the company manually)."
      );
      window.history.replaceState({}, "", "/rfp");
      return;
    }

    contractPrefillAppliedKeyRef.current = dedupeKey;
    skipNextWipPersist.current = true;
    localStorage.removeItem(RFP_WIP_STORAGE_KEY);
    suppressContactCompanySyncRef.current = true;

    contractPrefillSupplierIdsRef.current =
      payload.prefillSupplierIds && payload.prefillSupplierIds.length > 0
        ? [...payload.prefillSupplierIds]
        : null;
    contractPrefillSuppliersAppliedRef.current = false;

    setCustomerCompanyId(companyRow.id);
    setCustomerCompanySearch(companyRow.displayName);
    setRfpExtraCustomerContact(null);

    const cid = (payload.customerContactId || "").trim();
    if (cid && companyRow.contacts?.some((x) => x.id === cid)) {
      setCustomerContactId(cid);
    } else if (cid) {
      void fetch(`/api/contacts/${encodeURIComponent(cid)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            row: {
              id?: string;
              name?: string | null;
              firstName?: string | null;
              lastName?: string | null;
              email?: string | null;
              emails?: Array<{ email?: string | null }> | null;
              phone?: string | null;
              label?: string | null;
            } | null
          ) => {
          if (row && String(row.id) === cid) {
            setRfpExtraCustomerContact({
              id: String(row.id),
              customerId: companyRow.customerId ?? null,
              name: (row.name && String(row.name).trim()) || "Customer contact",
              firstName: row.firstName != null ? String(row.firstName) : null,
              lastName: row.lastName != null ? String(row.lastName) : null,
              email: effectiveContactEmailFromRecord(row),
              phone: row.phone != null ? String(row.phone) : null,
              label: row.label != null ? String(row.label) : null,
            });
          }
          setCustomerContactId(cid);
        }
        )
        .catch(() => {
          setCustomerContactId(companyRow.primaryContactId || companyRow.contacts?.[0]?.id || "");
        });
    } else {
      setCustomerContactId(companyRow.primaryContactId || companyRow.contacts?.[0]?.id || "");
    }

    skipNextBrokerMarginUnitDefaultRef.current = true;
    setEnergyType(payload.energyType);
    setBrokerMarginUnit(payload.brokerMarginUnit ?? defaultMarginUnitForEnergy(payload.energyType));
    setLdcUtility(payload.ldcUtility);
    setLdcUtilitySearch(payload.ldcUtility);
    setContractStartValue(payload.contractStartValue);
    setAccountLines(
      payload.accountLines.map((line) => ({
        id: crypto.randomUUID(),
        accountNumber: line.accountNumber,
        serviceAddress: line.serviceAddress,
        annualUsage: line.annualUsage,
        avgMonthlyUsage: line.avgMonthlyUsage,
        timing: { ...EMPTY_ACCOUNT_LINE_TIMING },
      }))
    );
    setBillDriveItems([]);
    setElectricPricing(emptyElectricPricingOptionsState());
    setSummarySpreadsheetUrl("");
    setSelectedSummaryDriveFileId("");
    setLocalBillFile(null);
    setLocalSummaryFile(null);
    setNotes(payload.notesFromContract.trim());
    setBrokerMargin(payload.brokerMargin.trim() ? payload.brokerMargin : "");
    setCustomTermMonths(payload.customTermMonths.trim());
    setQuoteDueDate("");
    setActiveDraftId(null);
    setReissueParentRfpId(null);
    setSelectedSupplierIds([]);
    setSelectedSupplierRecipients({});
    setResult(null);

    clearMemoryStagedContractPrefill();
    setDraftNotice(
      "RFP prefilled from contract data. Use Save RFP to keep it—otherwise close this tab or start over."
    );
    window.setTimeout(() => setDraftNotice(null), 12_000);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("fromContract");
    cleanUrl.searchParams.delete("prefillNonce");
    cleanUrl.searchParams.delete("prefillContractId");
    cleanUrl.searchParams.delete("prefillCustomerId");
    cleanUrl.searchParams.delete("prefillEnergy");
    cleanUrl.searchParams.delete("workflowRowId");
    cleanUrl.searchParams.delete("storage");
    window.history.replaceState(
      {},
      "",
      cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : "")
    );

    window.setTimeout(() => {
      suppressContactCompanySyncRef.current = false;
    }, 50);
  }, [loading, customerCompanies, contractPrefillHydrateTick]);

  const eligibleSuppliers = useMemo(() => {
    if (!energyType) return [];
    return suppliers
      .filter((supplier) => {
        const forEnergy = filterSupplierContactsForRfpEnergy(supplier.contactLinks ?? [], energyType);
        return forEnergy.length > 0;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [suppliers, energyType]);

  useEffect(() => {
    if (!energyType) return;
    if (skipNextBrokerMarginUnitDefaultRef.current) {
      skipNextBrokerMarginUnitDefaultRef.current = false;
      return;
    }
    setBrokerMarginUnit(defaultMarginUnitForEnergy(energyType));
  }, [energyType]);

  useEffect(() => {
    if (energyType !== "ELECTRIC") {
      setElectricPricing(emptyElectricPricingOptionsState());
    }
  }, [energyType]);

  useEffect(() => {
    /** Until /api/suppliers has loaded, eligibleSuppliers is empty — pruning would wipe draft selections. */
    if (suppliers.length === 0) return;
    setSelectedSupplierIds((prev) => {
      const setEl = new Set(eligibleSuppliers.map((s) => s.id));
      return prev.filter((id) => setEl.has(id));
    });
  }, [eligibleSuppliers, suppliers.length]);

  useEffect(() => {
    if (loading || !energyType) return;
    if (suppliers.length === 0) return;
    const want = contractPrefillSupplierIdsRef.current;
    if (!want?.length) return;
    if (contractPrefillSuppliersAppliedRef.current) return;
    const setEl = new Set(eligibleSuppliers.map((s) => s.id));
    const toAdd = want.filter((id) => setEl.has(id));
    if (toAdd.length === 0) return;
    contractPrefillSuppliersAppliedRef.current = true;
    setSelectedSupplierIds((prev) => {
      const next = new Set(prev);
      for (const id of toAdd) next.add(id);
      return [...next];
    });
  }, [loading, energyType, suppliers.length, eligibleSuppliers]);

  useEffect(() => {
    if (!energyType) {
      lastEnergyForSuppliersRef.current = "";
      setSelectedSupplierIds([]);
      return;
    }
    const prevE = lastEnergyForSuppliersRef.current;
    lastEnergyForSuppliersRef.current = energyType;

    if (skipNextSupplierInclusionDefaultRef.current) {
      skipNextSupplierInclusionDefaultRef.current = false;
      lastEnergyForSuppliersRef.current = energyType;
      return;
    }

    if (prevE === "" && energyType) {
      setSelectedSupplierIds(eligibleSuppliers.map((s) => s.id));
    }
  }, [energyType, eligibleSuppliers]);

  useEffect(() => {
    if (!energyType) {
      setSelectedSupplierRecipients({});
      return;
    }
    /** Same as supplier id prune: avoid replacing loaded draft recipients with {} before suppliers hydrate. */
    if (suppliers.length === 0) return;
    const et = energyType;
    setSelectedSupplierRecipients((current) => {
      const next: Record<string, RfpSupplierRecipientSlot[]> = {};
      for (const supplier of eligibleSuppliers) {
        const forEnergy = filterSupplierContactsForRfpEnergy(supplier.contactLinks ?? [], et);
        if (forEnergy.length === 0) continue;
        const existing = current[supplier.id];
        const normalizeSlot = (s: RfpSupplierRecipientSlot): RfpSupplierRecipientSlot | null => {
          const c = forEnergy.find((x) => x.id === s.contactId);
          if (!c) return null;
          const emails = supplierContactDeliverableEmails(c);
          const em = (s.email || "").trim();
          if (em) {
            const ok = emails.some((e) => e.toLowerCase() === em.toLowerCase());
            return ok ? { contactId: s.contactId, email: em } : null;
          }
          const first = emails[0];
          return first ? { contactId: s.contactId, email: first } : null;
        };
        if (Array.isArray(existing) && existing.length > 0) {
          const kept = existing.map(normalizeSlot).filter((x): x is RfpSupplierRecipientSlot => x != null);
          if (kept.length > 0) next[supplier.id] = kept;
          else next[supplier.id] = defaultRecipientSlotsForContacts(forEnergy);
        } else {
          next[supplier.id] = defaultRecipientSlotsForContacts(forEnergy);
        }
      }
      return next;
    });
  }, [eligibleSuppliers, energyType, suppliers.length]);

  useEffect(() => {
    if (suppressContactCompanySyncRef.current) return;
    const selectedCustomer = customerCompanies.find((customer) => customer.id === customerCompanyId);
    const firstContactId = selectedCustomer?.primaryContactId || selectedCustomer?.contacts?.[0]?.id || "";
    setCustomerContactId((current) => {
      if (!selectedCustomer) {
        /** Continue Editing: draft may have no matched company row while `rfpExtraCustomerContact` holds the saved contact — do not wipe. */
        if (rfpExtraCustomerContact && rfpExtraCustomerContact.id === current) return current;
        return "";
      }
      const inCompanyBucket = selectedCustomer.contacts?.some((contact) => contact.id === current) ?? false;
      if (inCompanyBucket) return current;
      /** Contract→RFP (or loaded draft) can set a main contact via `rfpExtraCustomerContact` when that id is missing from the bucket list — do not replace it with the first bucket contact. */
      if (rfpExtraCustomerContact && rfpExtraCustomerContact.id === current) return current;
      return firstContactId;
    });
  }, [customerCompanyId, customerCompanies, rfpExtraCustomerContact]);

  useEffect(() => {
    const selectedCompany = customerCompanies.find((customer) => customer.id === customerCompanyId);
    if (!selectedCompany) return;
    setCustomerCompanySearch(selectedCompany.displayName);
  }, [customerCompanyId, customerCompanies]);

  useEffect(() => {
    if (!customerContactId) {
      setContactRecordCustomerId(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/contacts/${encodeURIComponent(customerContactId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((row: { customerId?: string | null } | null) => {
        if (cancelled) return;
        const cid =
          row && typeof row.customerId === "string" && row.customerId.trim()
            ? row.customerId.trim()
            : null;
        setContactRecordCustomerId(cid);
      })
      .catch(() => {
        if (!cancelled) setContactRecordCustomerId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerContactId]);

  /** Mirrors outgoing supplier emails (deduped by address) for the send confirmation modal. */
  const sendConfirmRecipients = useMemo(() => {
    if (!energyType) return [];
    const et = energyType as EnergyType;
    const rows: { supplierName: string; contactName: string; email: string }[] = [];
    for (const supplierId of selectedSupplierIds) {
      const supplier = suppliers.find((s) => s.id === supplierId);
      if (!supplier) continue;
      const forEnergy = filterSupplierContactsForRfpEnergy(supplier.contactLinks ?? [], et);
      const slots = selectedSupplierRecipients[supplierId] ?? [];
      for (const slot of slots) {
        const contact = forEnergy.find((c) => c.id === slot.contactId);
        if (!contact) continue;
        const deliverable = supplierContactDeliverableEmails(contact);
        const em = slot.email.trim();
        if (!em) continue;
        if (!deliverable.some((e) => e.trim().toLowerCase() === em.toLowerCase())) continue;
        rows.push({
          supplierName: supplier.name,
          contactName: (contact.name || "").trim() || "—",
          email: em,
        });
      }
    }
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = r.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [energyType, selectedSupplierIds, selectedSupplierRecipients, suppliers]);

  const suppliersMissingEnergyLabels = useMemo(
    () =>
      suppliers.filter((supplier) => {
        const links = supplier.contactLinks?.filter((c) => !isRetiredSupplierContact(c.label)) ?? [];
        const supplierTagged = links.some((contact) => isSupplierCandidateContact(contact.label));
        const hasEnergyLabel = links.some(
          (contact) =>
            contactMatchesRfpEnergy(contact.label, "ELECTRIC") ||
            contactMatchesRfpEnergy(contact.label, "NATURAL_GAS")
        );
        return Boolean(supplierTagged && !hasEnergyLabel);
      }),
    [suppliers]
  );

  const selectedCustomer = customerCompanies.find((customer) => customer.id === customerCompanyId) ?? null;
  const customerContacts = selectedCustomer?.contacts ?? [];
  const customerContactsForSelect = useMemo(() => {
    const base = customerContacts;
    const cid = customerContactId.trim();
    if (!cid) return base;
    const extra = rfpExtraCustomerContact;
    const idx = base.findIndex((c) => c.id === cid);
    if (extra && extra.id === cid) {
      if (idx >= 0) {
        const cur = base[idx];
        return base.map((c, i) =>
          i === idx
            ? {
                ...cur,
                ...extra,
                customerId: extra.customerId ?? cur.customerId,
                label: extra.label ?? cur.label,
              }
            : c
        );
      }
      return [...base, extra];
    }
    return base;
  }, [customerContacts, rfpExtraCustomerContact, customerContactId]);
  const selectedCustomerHasContacts = customerContactsForSelect.length > 0;
  const selectedCustomerNeedsSetup = Boolean(selectedCustomer && !selectedCustomerHasContacts);
  const resolvedCustomerIdForValidation =
    selectedCustomer?.customerId ||
    customerContactsForSelect.find((contact) => contact.id === customerContactId)?.customerId ||
    contactRecordCustomerId ||
    "";
  const filteredCustomerCompanies = useMemo(() => {
    const base = customerCompanies.filter((c) => {
      const n = String(c.displayName ?? "").trim();
      return n !== "." && n !== "";
    });
    const query = customerCompanySearch.trim().toLowerCase();
    if (!query) return base;
    /** While dropdown is open with an existing pick, show full list until the user types (clears selection). */
    if (customerCompanyDropdownOpen && customerCompanyId) return base;
    return base.filter((customer) => {
      const label = customer.displayName.toLowerCase();
      if (label.startsWith(query)) return true;
      return label.split(/\s+/).some((part) => part.startsWith(query));
    });
  }, [
    customerCompanies,
    customerCompanySearch,
    customerCompanyDropdownOpen,
    customerCompanyId,
  ]);
  const suppliersTableRows = useMemo(() => {
    if (!energyType) return [];
    const et = energyType;
    return eligibleSuppliers.map((supplier) => {
      const all = supplier.contactLinks ?? [];
      const contacts = filterSupplierContactsForRfpEnergy(all, et);
      const selectedSlots = selectedSupplierRecipients[supplier.id] ?? [];
      return {
        supplier,
        contacts,
        selectedSlots,
      };
    });
  }, [eligibleSuppliers, energyType, selectedSupplierRecipients]);

  const enrollmentDetailsPayload = useMemo(
    () => buildEnrollmentDetailsPayload(accountLines),
    [accountLines]
  );

  const accountTimingModalLine = useMemo(
    () =>
      accountTimingModalLineId == null
        ? null
        : accountLines.find((l) => l.id === accountTimingModalLineId) ?? null,
    [accountLines, accountTimingModalLineId]
  );
  const accountTimingModalOrdinal = useMemo(() => {
    if (!accountTimingModalLine) return 0;
    const i = accountLines.findIndex((l) => l.id === accountTimingModalLine.id);
    return i >= 0 ? i + 1 : 0;
  }, [accountLines, accountTimingModalLine]);

  const draftRfqs = useMemo(
    () => recentRfqs.filter((r) => r.status === "draft" && r.archivedAt == null),
    [recentRfqs]
  );
  const submittedRfqs = useMemo(
    () => recentRfqs.filter((r) => r.status !== "draft" && r.archivedAt == null),
    [recentRfqs]
  );

  const rfpFormFingerprint = useMemo(
    () =>
      computeRfpFingerprint({
        customerCompanyId,
        customerContactId,
        energyType,
        selectedSupplierIds,
        selectedSupplierRecipients,
        requestedTerms,
        customTermMonths,
        contractStartValue,
        quoteDueDate,
        billDriveItemsKey: billDriveItemsFingerprintKey(billDriveItems),
        summarySpreadsheetUrl,
        ldcUtility,
        brokerMargin,
        brokerMarginUnit,
        notes,
        accountLines,
        selectedSummaryDriveFileId,
        electricPricingKey: electricPricingFingerprintKey(
          energyType === "ELECTRIC" ? electricPricing : null
        ),
        reissueParentRfpId,
      }),
    [
      customerCompanyId,
      customerContactId,
      energyType,
      selectedSupplierIds,
      selectedSupplierRecipients,
      requestedTerms,
      customTermMonths,
      contractStartValue,
      quoteDueDate,
      billDriveItems,
      summarySpreadsheetUrl,
      ldcUtility,
      brokerMargin,
      brokerMarginUnit,
      electricPricing,
      notes,
      accountLines,
      selectedSummaryDriveFileId,
      reissueParentRfpId,
    ]
  );

  const isRfpDirty =
    baselineFingerprint !== null && rfpFormFingerprint !== baselineFingerprint;

  const rfpFormFingerprintRef = useRef(rfpFormFingerprint);
  rfpFormFingerprintRef.current = rfpFormFingerprint;

  /** After Reset, skip leave/beforeunload prompts until the form is clean again (baseline matches). */
  const [suppressUnsavedNavAfterReset, setSuppressUnsavedNavAfterReset] = useState(false);

  useEffect(() => {
    if (loading || baselineFingerprint !== null) return;
    setBaselineFingerprint(rfpFormFingerprint);
  }, [loading, baselineFingerprint, rfpFormFingerprint]);

  useEffect(() => {
    if (suppressUnsavedNavAfterReset && !isRfpDirty) {
      setSuppressUnsavedNavAfterReset(false);
    }
  }, [isRfpDirty, suppressUnsavedNavAfterReset]);

  useEffect(() => {
    const warn = isRfpDirty && !suppressUnsavedNavAfterReset;
    if (!warn) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isRfpDirty, suppressUnsavedNavAfterReset]);

  const confirmLeaveRfp = useCallback(() => {
    clearLocalWipAndResetForm();
  }, []);

  useUnsavedNavigationBlock(
    isRfpDirty && !suppressUnsavedNavAfterReset,
    "You have unsaved changes on this RFP. Leave without saving?",
    confirmLeaveRfp
  );

  useEffect(() => {
    const cid = resolvedCustomerIdForValidation?.trim();
    if (!cid) {
      setCustomerContractsReminder([]);
      return;
    }
    let cancelled = false;
    setCustomerContractsReminderLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          "/api/contracts?tab=active&mergeRecentExpiredDays=30&sort=expirationDate&order=asc"
        );
        const data = await res.json();
        const list = (Array.isArray(data) ? data : []) as CustomerContractRow[];
        const mine = list.filter((c) => c.customer?.id === cid);
        if (!cancelled) setCustomerContractsReminder(mine);
      } catch {
        if (!cancelled) setCustomerContractsReminder([]);
      } finally {
        if (!cancelled) setCustomerContractsReminderLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedCustomerIdForValidation]);

  const contractStartMonth = contractStartValue ? Number.parseInt(contractStartValue.split("-")[1] || "", 10) : null;
  const contractStartYear = contractStartValue ? Number.parseInt(contractStartValue.split("-")[0] || "", 10) : null;
  const sortedDriveFiles = useMemo(() => {
    const files = [...driveFiles];
    files.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      if (driveSort === "modified") {
        const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
        const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
        return bTime - aTime || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      if (driveSort === "size") {
        const aSize = a.size ?? -1;
        const bSize = b.size ?? -1;
        return bSize - aSize || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return files;
  }, [driveFiles, driveSort]);

  const totals = useMemo(() => {
    return accountLines.reduce(
      (acc, line) => {
        const annualUsage = toNumber(line.annualUsage);
        const avgMonthlyUsage = toNumber(line.avgMonthlyUsage);
        const margin = toNumber(brokerMargin);
        const monthsToUse = termsForCalculations(requestedTerms, customTermMonths);

        acc.totalAnnualUsage += annualUsage;
        acc.totalAvgMonthlyUsage += avgMonthlyUsage;

        for (const months of monthsToUse) {
          const brokerIncome = avgMonthlyUsage * months * margin;
          acc.byTerm[months] = acc.byTerm[months] || { brokerIncome: 0 };
          acc.byTerm[months].brokerIncome += brokerIncome;
        }

        return acc;
      },
      {
        totalAnnualUsage: 0,
        totalAvgMonthlyUsage: 0,
        byTerm: {} as Record<number, { brokerIncome: number }>,
      }
    );
  }, [accountLines, brokerMargin, requestedTerms, customTermMonths]);

  const termsChecklistSummary = useMemo(() => {
    const parts = requestedTerms.map((t) => (t === "NYMEX" ? "NYMEX" : `${t} mo`));
    if (customTermMonths.trim()) parts.push(`custom: ${customTermMonths}`);
    return parts.length ? parts.join(", ") : "";
  }, [requestedTerms, customTermMonths]);

  const usageSummaryWhenMultiChecklistOk =
    accountLines.length <= 1 ||
    accountLines.every(
      (line) =>
        line.accountNumber.trim() &&
        line.annualUsage.trim() &&
        line.avgMonthlyUsage.trim()
    );

  function dismissResultError() {
    setResult((current) => {
      if (!current?.error) return current;
      const { error: _e, ...rest } = current;
      return Object.keys(rest).length > 0 ? (rest as typeof current) : null;
    });
  }

  async function confirmRecentRfpArchive() {
    const rfp = recentRfpArchiveTarget;
    if (!rfp) return;
    setRecentRfpArchiveBusy(true);
    try {
      const hydrated = hydrateQuoteComparisonPicks(rfp.quoteComparisonPicks);
      const pickSnap: QuoteWorkspaceSnapshotV1["pickByTerm"] = {};
      for (const [k, v] of Object.entries(hydrated)) {
        if (v) pickSnap[String(k)] = v;
      }
      const quoteWorkspaceSnapshot: QuoteWorkspaceSnapshotV1 = {
        version: 1,
        pickByTerm: pickSnap,
        manualRows: [],
        extraTermMonths: [],
        capturedAt: new Date().toISOString(),
      };
      const res = await fetch(`/api/rfp/${encodeURIComponent(rfp.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true, quoteWorkspaceSnapshot }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        createdContractId?: string | null;
        archiveSkippedContractReason?: string | null;
        error?: string;
      };
      setRecentRfpArchiveTarget(null);
      await loadPageData();
      if (!res.ok) {
        window.alert(data.error || "Could not archive this RFP.");
        return;
      }
      if (data.createdContractId) {
        const go = window.confirm(
          "A contract was added to the Contracts directory with details from this RFP. Open Edit Contract now to confirm rate and executed terms?"
        );
        if (go) {
          router.push(
            `/directory/contracts?contractId=${encodeURIComponent(data.createdContractId)}&fromArchive=1`
          );
        }
      } else if (data.archiveSkippedContractReason) {
        window.alert(data.archiveSkippedContractReason);
      }
    } finally {
      setRecentRfpArchiveBusy(false);
    }
  }

  async function loadPageData() {
    setLoading(true);
    try {
      const [customersRes, suppliersRes, rfpRes, archivedRes] = await Promise.all([
        fetch("/api/contacts/customer-companies", { cache: "no-store" }),
        fetch("/api/suppliers?contacts=1&filter=all&materializeFromContacts=1", { cache: "no-store" }),
        fetch("/api/rfp", { cache: "no-store" }),
        fetch("/api/rfp?archivedOnly=1", { cache: "no-store" }),
      ]);
      const [customersData, suppliersData, rfpData, archivedData] = await Promise.all([
        customersRes.json(),
        suppliersRes.json(),
        rfpRes.json(),
        archivedRes.json().catch(() => []),
      ]);

      const companyOptions = (Array.isArray(customersData?.companies) ? customersData.companies : []).filter(
        (c: CustomerCompanyOption) => {
          const n = String(c.displayName ?? "").trim();
          return n !== "." && n !== "";
        }
      );
      setCustomerCompanies(companyOptions);
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
      setRecentRfqs(Array.isArray(rfpData) ? rfpData.slice(0, 40) : []);
      setArchivedRfqs(Array.isArray(archivedData) ? archivedData.slice(0, 60) : []);
      return companyOptions as CustomerCompanyOption[];
    } finally {
      setLoading(false);
    }
  }

  async function deleteRfpById(id: string) {
    setDeleteRfpLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/rfp/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Delete failed");
      setActiveDraftId((cur) => (cur === id ? null : cur));
      setDeleteRfpTarget(null);
      await loadPageData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete RFP";
      setResult({ error: msg });
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setDeleteRfpLoading(false);
    }
  }

  function openCustomerSetupDialog() {
    if (!selectedCustomer) return;
    setAttachContactCustomerId(selectedCustomer.customerId);
    setCustomerDraft((current) => ({
      ...current,
      customerName: selectedCustomer.displayName,
      company: selectedCustomer.displayName,
      contactName: current.contactName || selectedCustomer.contacts?.[0]?.name || "",
      contactEmail: current.contactEmail || selectedCustomer.contacts?.[0]?.email || "",
      contactPhone: formatUsPhoneDigits(
        current.contactPhone || selectedCustomer.contacts?.[0]?.phone || ""
      ),
      contactLabel: current.contactLabel || defaultCustomerContactLabels(energyType),
    }));
    setCustomerDialogOpen(true);
  }

  async function refreshSupplierRows() {
    setSupplierDirectoryRefreshing(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/suppliers?contacts=1&filter=all&materializeFromContacts=1&_=${Date.now()}`,
        {
          cache: "no-store",
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data && typeof (data as { error?: string }).error === "string"
            ? (data as { error: string }).error
            : `Could not refresh suppliers (${res.status})`;
        setResult({ error: msg });
        return;
      }
      if (!Array.isArray(data)) {
        setResult({ error: "Unexpected response when refreshing suppliers." });
        return;
      }
      setSuppliers(data);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Failed to refresh suppliers" });
    } finally {
      setSupplierDirectoryRefreshing(false);
    }
  }

  function recipientSlotKey(s: RfpSupplierRecipientSlot) {
    return `${s.contactId}\t${s.email.trim().toLowerCase()}`;
  }

  async function persistRfpEmailLabelPreference(contactId: string, email: string, preferForRfp: boolean) {
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/rfp-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, preferForRfp }),
      });
      if (res.ok) await refreshSupplierRows();
    } catch {
      /* non-blocking */
    }
  }

  function toggleSupplierRecipientSlot(
    supplierId: string,
    contactId: string,
    email: string,
    checked: boolean
  ) {
    const norm = email.trim();
    if (!norm) return;
    setSelectedSupplierRecipients((current) => {
      const prev = current[supplierId] ?? [];
      const next = checked
        ? [...prev, { contactId, email: norm }].filter(
            (s, i, arr) => arr.findIndex((x) => recipientSlotKey(x) === recipientSlotKey(s)) === i
          )
        : prev.filter(
            (s) =>
              !(s.contactId === contactId && s.email.trim().toLowerCase() === norm.toLowerCase())
          );
      return { ...current, [supplierId]: next };
    });
    void persistRfpEmailLabelPreference(contactId, norm, checked);
  }

  async function persistSupplierContactPrimary(contactId: string, wantPrimary: boolean) {
    setSupplierContactPrimarySavingId(contactId);
    setResult(null);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPriority: wantPrimary }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          data && typeof data.error === "string" ? data.error : "Failed to update primary on contact"
        );
      }
      await refreshSupplierRows();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Failed to update primary" });
    } finally {
      setSupplierContactPrimarySavingId(null);
    }
  }

  function toggleElectricPricingOption(id: ElectricPricingOptionId, checked: boolean) {
    setElectricPricing((prev) => {
      const nextSet = new Set(prev.selectedIds);
      if (checked) nextSet.add(id);
      else nextSet.delete(id);
      const selectedIds = Array.from(nextSet) as ElectricPricingOptionId[];
      let fixedRateCapacityAdjustNote = prev.fixedRateCapacityAdjustNote;
      if (!nextSet.has("fixed_rate_capacity_adjust")) fixedRateCapacityAdjustNote = "";
      return { selectedIds, fixedRateCapacityAdjustNote };
    });
  }

  function validateRfpRequest() {
    if (!customerCompanyId) {
      return "Select a customer company before previewing or sending the RFP.";
    }
    if (!energyType) {
      return "Select an energy type (Natural Gas or Electric) before previewing or sending the RFP.";
    }
    const termErr = validateCustomTermsInput(customTermMonths);
    if (termErr) return termErr;
    if (energyType === "ELECTRIC") {
      if (
        electricPricing.selectedIds.includes("fixed_rate_capacity_adjust") &&
        !electricPricing.fixedRateCapacityAdjustNote.trim()
      ) {
        return 'When "Fixed rate capacity adjust" is selected, enter the note for that option.';
      }
    }
    if (!customerContactId) {
      return "Select a customer contact before previewing or sending the RFP.";
    }
    if (selectedSupplierIds.length === 0) {
      return "No suppliers match the selected energy type with supplier + gas/electric labels. Add labels on the Contacts page.";
    }
    if (
      selectedSupplierIds.some((supplierId) => {
        const slots = selectedSupplierRecipients[supplierId] ?? [];
        if (slots.length === 0) return true;
        const supplier = suppliers.find((s) => s.id === supplierId);
        const forEnergy = filterSupplierContactsForRfpEnergy(
          supplier?.contactLinks ?? [],
          energyType as EnergyType
        );
        return slots.some((s) => {
          const contact = forEnergy.find((c) => c.id === s.contactId);
          const emails = contact ? supplierContactDeliverableEmails(contact) : [];
          return (
            !contact ||
            !emails.some((e) => e.trim().toLowerCase() === s.email.trim().toLowerCase())
          );
        });
      })
    ) {
      return "Each included supplier needs at least one valid email selected to receive the RFP.";
    }
    return null;
  }

  function toggleRequestedTerm(term: RequestedTerm) {
    setRequestedTerms((current) =>
      current.includes(term) ? current.filter((value) => value !== term) : [...current, term]
    );
  }

  function toggleSupplierIncluded(supplierId: string) {
    setSelectedSupplierIds((prev) =>
      prev.includes(supplierId) ? prev.filter((id) => id !== supplierId) : [...prev, supplierId]
    );
  }

  function clearLocalWipAndResetForm() {
    setSuppressUnsavedNavAfterReset(true);
    skipNextWipPersist.current = true;
    localStorage.removeItem(RFP_WIP_STORAGE_KEY);
    setCustomerCompanyId("");
    setCustomerCompanySearch("");
    setCustomerContactId("");
    setRfpExtraCustomerContact(null);
    setEnergyType("");
    setSelectedSupplierIds([]);
    setSelectedSupplierRecipients({});
    setRequestedTerms(["12", "24", "36"]);
    setCustomTermMonths("");
    setCustomTermsError("");
    setContractStartValue("");
    setQuoteDueDate("");
    setBillDriveItems([]);
    setElectricPricing(emptyElectricPricingOptionsState());
    setSummarySpreadsheetUrl("");
    setLdcUtility("");
    setLdcUtilitySearch("");
    setLdcUtilityDropdownOpen(false);
    setBrokerMargin("");
    setNotes("");
    setAccountLines([emptyAccountLine()]);
    setLocalBillFile(null);
    setLocalSummaryFile(null);
    setSelectedSummaryDriveFileId("");
    setActiveDraftId(null);
    setReissueParentRfpId(null);
    setResult(null);
    setRfpTestEmailOk(false);
    setTestEmailFoundId(null);
    setAccountTimingModalLineId(null);
    setSupplierSelectHelpOpen(false);
    setBaselineFingerprint(
      computeRfpFingerprint({
        customerCompanyId: "",
        customerContactId: "",
        energyType: "",
        selectedSupplierIds: [],
        selectedSupplierRecipients: {},
        requestedTerms: ["12", "24", "36"],
        customTermMonths: "",
        contractStartValue: "",
        quoteDueDate: "",
        billDriveItemsKey: billDriveItemsFingerprintKey([]),
        summarySpreadsheetUrl: "",
        ldcUtility: "",
        brokerMargin: "",
        brokerMarginUnit: "MCF",
        notes: "",
        accountLines: [
          {
            id: "",
            accountNumber: "",
            serviceAddress: "",
            annualUsage: "",
            avgMonthlyUsage: "",
            timing: { ...EMPTY_ACCOUNT_LINE_TIMING },
          },
        ],
        selectedSummaryDriveFileId: "",
        electricPricingKey: "",
        reissueParentRfpId: null,
      })
    );
  }

  async function saveDraftToServer() {
    if (!customerCompanyId || !customerContactId || !energyType) {
      setResult({
        error: "Select a customer company, contact, and energy type before saving.",
      });
      return;
    }
    setSavingDraft(true);
    setResult(null);
    try {
      const contactSelections: Record<string, RfpSupplierRecipientSlot[]> = {};
      for (const sid of selectedSupplierIds) {
        const slots = selectedSupplierRecipients[sid]?.filter((s) => s.email.trim()) ?? [];
        if (slots.length > 0) contactSelections[sid] = slots;
      }
      const res = await fetch("/api/rfp/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: activeDraftId || undefined,
          customerId: resolvedCustomerIdForValidation.trim() ? resolvedCustomerIdForValidation.trim() : null,
          customerContactId: customerContactId.trim() ? customerContactId.trim() : null,
          energyType,
          supplierIds: selectedSupplierIds,
          supplierContactSelections: contactSelections,
          requestedTerms,
          customTermMonths: customTermMonths || undefined,
          quoteDueDate: quoteDueDate || undefined,
          contractStartMonth: contractStartMonth || undefined,
          contractStartYear: contractStartYear || undefined,
          billDriveItems: billDriveItems.length > 0 ? billDriveItems : undefined,
          googleDriveFolderUrl: billDriveItems[0]?.webViewLink || undefined,
          summarySpreadsheetUrl: summarySpreadsheetUrl || undefined,
          ldcUtility: ldcUtility || undefined,
          brokerMargin: brokerMargin || undefined,
          brokerMarginUnit,
          accountLines: accountLines.map((line) => ({
            accountNumber: line.accountNumber,
            serviceAddress: line.serviceAddress || undefined,
            annualUsage: line.annualUsage,
            avgMonthlyUsage: line.avgMonthlyUsage,
          })),
          notes: notes || undefined,
          enrollmentDetails: enrollmentDetailsPayload ?? undefined,
          electricPricingOptions:
            energyType === "ELECTRIC"
              ? {
                  selectedIds: electricPricing.selectedIds,
                  fixedRateCapacityAdjustNote:
                    electricPricing.fixedRateCapacityAdjustNote.trim() || undefined,
                }
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");
      setActiveDraftId(data.id);
      await linkPendingWorkflowRowToRfp(String(data.id));
      setBaselineFingerprint(
        computeRfpFingerprint({
          customerCompanyId,
          customerContactId,
          energyType,
          selectedSupplierIds,
          selectedSupplierRecipients,
          requestedTerms,
          customTermMonths,
          contractStartValue,
          quoteDueDate,
          billDriveItemsKey: billDriveItemsFingerprintKey(billDriveItems),
          summarySpreadsheetUrl,
          ldcUtility,
          brokerMargin,
          brokerMarginUnit,
          notes,
          accountLines,
          selectedSummaryDriveFileId,
          electricPricingKey: electricPricingFingerprintKey(
            energyType === "ELECTRIC" ? electricPricing : null
          ),
          reissueParentRfpId,
        })
      );
      await loadPageData();
      setDraftNotice("RFP saved. Open it anytime under Recent RFPs → Unsubmitted.");
      window.setTimeout(() => setDraftNotice(null), 6000);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to save draft" });
    } finally {
      setSavingDraft(false);
    }
  }

  function clearCustomerRfpLoadedTimers() {
    const t = customerRfpLoadedTimersRef.current;
    if (t.toFade) clearTimeout(t.toFade);
    if (t.toHide) clearTimeout(t.toHide);
    t.toFade = undefined;
    t.toHide = undefined;
  }

  function revealCustomerRfpLoadedBanner() {
    clearCustomerRfpLoadedTimers();
    setCustomerRfpLoadedBanner("visible");
    customerRfpLoadedTimersRef.current.toFade = setTimeout(() => {
      setCustomerRfpLoadedBanner("fading");
      customerRfpLoadedTimersRef.current.toHide = setTimeout(() => {
        setCustomerRfpLoadedBanner("hidden");
        customerRfpLoadedTimersRef.current.toHide = undefined;
      }, 500);
    }, 10_000);
  }

  function dismissCustomerRfpLoadedBanner() {
    clearCustomerRfpLoadedTimers();
    setCustomerRfpLoadedBanner("hidden");
  }

  async function loadSavedRfpIntoForm(id: string, options?: { showCustomerRfpLoaded?: boolean }) {
    setLoading(true);
    setResult(null);
    suppressContactCompanySyncRef.current = true;
    skipNextSupplierInclusionDefaultRef.current = true;
    try {
      const [rfpRes, companiesRes] = await Promise.all([
        fetch(`/api/rfp/${encodeURIComponent(id)}`),
        fetch("/api/contacts/customer-companies"),
      ]);
      const data = (await rfpRes.json()) as LoadedRfpApiResponse;
      if (!rfpRes.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to load RFP");

      const companyOptions = normalizeCustomerCompaniesPayload(await companiesRes.json().catch(() => ({})));
      setCustomerCompanies(companyOptions);

      const companyRow = resolveSavedRfpCompanyRow(companyOptions, data);
      const contactId = resolvedLoadedRfpCustomerContactId(data);

      if (companyRow) {
        setCustomerCompanyId(companyRow.id);
        setCustomerCompanySearch(companyRow.displayName);
      } else if (data.customer) {
        setCustomerCompanyId("");
        setCustomerCompanySearch(
          [data.customer.name, data.customer.company].filter(Boolean).join(" — ") || ""
        );
      } else if (data.customerContact) {
        setCustomerCompanyId("");
        setCustomerCompanySearch(
          [data.customerContact.company, data.customerContact.name].filter(Boolean).join(" — ") || ""
        );
      } else {
        setCustomerCompanyId("");
        setCustomerCompanySearch("");
      }

      let cc: LoadedRfpCustomerPayload["customerContact"] = null;
      if (contactId && data.customerContact && String(data.customerContact.id ?? "") === contactId) {
        cc = data.customerContact;
      }
      let contactRowCustomerId: string | null =
        cc?.customerId != null && String(cc.customerId).trim() ? String(cc.customerId).trim() : null;
      if (contactId && (!cc || String(cc.id) !== contactId)) {
        try {
          const r = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`);
          if (r.ok) {
            const row = (await r.json()) as {
              id?: string;
              name?: string | null;
              firstName?: string | null;
              lastName?: string | null;
              email?: string | null;
              emails?: Array<{ email?: string | null }> | null;
              phone?: string | null;
              company?: string | null;
              label?: string | null;
              customerId?: string | null;
            };
            if (row && String(row.id) === contactId) {
              contactRowCustomerId = row.customerId != null ? String(row.customerId) : null;
              cc = {
                id: String(row.id),
                name: row.name,
                firstName: row.firstName,
                lastName: row.lastName,
                email: effectiveContactEmailFromRecord(row),
                emails: row.emails,
                phone: row.phone,
                company: row.company,
                label: row.label,
                customerId: row.customerId,
              };
            }
          }
        } catch {
          /* ignore */
        }
      }

      let extraContact: NonNullable<CustomerCompanyOption["contacts"]>[number] | null = null;
      if (contactId && cc && String(cc.id) === contactId) {
        const displayEmail = effectiveContactEmailFromRecord(cc);
        extraContact = {
          id: String(cc.id),
          customerId: companyRow?.customerId ?? contactRowCustomerId,
          name: (cc.name && String(cc.name).trim()) || "Customer contact",
          firstName: cc.firstName != null ? String(cc.firstName) : null,
          lastName: cc.lastName != null ? String(cc.lastName) : null,
          email: displayEmail,
          phone: cc.phone != null ? String(cc.phone) : null,
          label: cc.label != null ? String(cc.label) : null,
        };
      }

      setRfpExtraCustomerContact(extraContact);
      setCustomerContactId(contactId);
      if (data.energyType === "ELECTRIC" || data.energyType === "NATURAL_GAS") {
        setEnergyType(data.energyType);
      }
      const supIds = Array.isArray(data.suppliers) ? data.suppliers.map((s: { id: string }) => s.id) : [];
      setSelectedSupplierIds(supIds);
      setRequestedTerms(mapDbTermsToRequestedTerms(data.requestedTerms));
      setCustomTermMonths(mapDbTermsToCustomMonthsString(data.requestedTerms));
      setContractStartValue(
        data.contractStartYear && data.contractStartMonth
          ? `${String(data.contractStartYear).padStart(4, "0")}-${String(data.contractStartMonth).padStart(2, "0")}`
          : ""
      );
      setQuoteDueDate(
        data.quoteDueDate ? String(data.quoteDueDate).slice(0, 10) : ""
      );
      {
        let loadedBills = normalizeRfpBillDriveItemsFromDb(data.billDriveItems);
        if (loadedBills.length === 0 && data.googleDriveFolderUrl) {
          const u = String(data.googleDriveFolderUrl).trim();
          if (u) loadedBills = [{ webViewLink: u }];
        }
        setBillDriveItems(loadedBills);
      }
      if (data.energyType === "ELECTRIC") {
        setElectricPricing(
          normalizeElectricPricingFromDb(data.electricPricingOptions, "ELECTRIC") ??
            emptyElectricPricingOptionsState()
        );
      } else {
        setElectricPricing(emptyElectricPricingOptionsState());
      }
      setSummarySpreadsheetUrl(data.summarySpreadsheetUrl || "");
      setLdcUtility(data.ldcUtility || "");
      setBrokerMargin(data.brokerMargin != null ? String(data.brokerMargin) : "");
      if (data.brokerMarginUnit === "KWH" || data.brokerMarginUnit === "MCF" || data.brokerMarginUnit === "CCF" || data.brokerMarginUnit === "DTH") {
        setBrokerMarginUnit(data.brokerMarginUnit);
      }
      setNotes(data.notes || "");
      const edLoad =
        data.enrollmentDetails && typeof data.enrollmentDetails === "object" && !Array.isArray(data.enrollmentDetails)
          ? (data.enrollmentDetails as Record<string, unknown>)
          : null;
      setAccountLines(hydrateAccountLinesFromRfpApi(data.accountLines, edLoad));
      setSelectedSupplierRecipients(normalizeSupplierRecipientSelectionsFromApi(data.supplierContactSelections));
      if (data.status === "draft") {
        setActiveDraftId(typeof data.id === "string" ? data.id : null);
        setReissueParentRfpId(null);
      } else {
        setActiveDraftId(null);
        setReissueParentRfpId(typeof data.id === "string" ? data.id : null);
      }
      const loadedCompanyRowId = companyRow?.id ?? "";
      setBaselineFingerprint(fingerprintFromLoadedRfp(data, loadedCompanyRowId));
      if (options?.showCustomerRfpLoaded) {
        revealCustomerRfpLoadedBanner();
      }
      await linkPendingWorkflowRowToRfp(String(data.id));
      window.setTimeout(() => {
        suppressContactCompanySyncRef.current = false;
      }, 50);
    } catch (error) {
      suppressContactCompanySyncRef.current = false;
      setResult({ error: error instanceof Error ? error.message : "Failed to load RFP" });
    } finally {
      setLoading(false);
    }
  }

  function updateAccountLine(id: string, field: keyof AccountLine, value: string) {
    setAccountLines((current) =>
      current.map((line) => (line.id === id ? { ...line, [field]: value } : line))
    );
  }

  function updateAccountLineTiming(id: string, field: keyof AccountLineTiming, value: string) {
    setAccountLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, timing: { ...line.timing, [field]: value } } : line
      )
    );
  }

  function addAccountLine() {
    setAccountLines((current) => [...current, emptyAccountLine()]);
  }

  function removeAccountLine(id: string) {
    setAccountLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== id)));
  }

  async function handleCreateCustomer() {
    setCreatingCustomer(true);
    setResult(null);
    try {
      const targetCustomer =
        attachContactCustomerId != null
          ? customerCompanies.find((customer) => customer.customerId === attachContactCustomerId) ?? null
          : null;

      let customerData:
        | {
            id: string;
            name: string;
            company: string | null;
          }
        | null = targetCustomer
        ? {
            id: targetCustomer.customerId || "",
            name: targetCustomer.displayName,
            company: targetCustomer.displayName,
          }
        : null;

      if (!customerData) {
        const customerRes = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: customerDraft.customerName,
            company: customerDraft.company || undefined,
            email: customerDraft.email || undefined,
            phone: customerDraft.phone || undefined,
            address: customerDraft.address || undefined,
            city: customerDraft.city || undefined,
            state: customerDraft.state || undefined,
            zip: customerDraft.zip || undefined,
            notes: customerDraft.notes || undefined,
          }),
        });
        const createdCustomer = await customerRes.json();
        if (!customerRes.ok) throw new Error(createdCustomer.error || "Failed to create customer");
        customerData = createdCustomer;
      }
      if (!customerData) {
        throw new Error("Customer record unavailable for contact creation");
      }

      const contactRes = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:
            customerDraft.contactName ||
            customerDraft.customerName ||
            targetCustomer?.displayName ||
            "Customer Contact",
          email: customerDraft.contactEmail || customerDraft.email || undefined,
          phone: customerDraft.contactPhone || customerDraft.phone || undefined,
          company: customerDraft.company || targetCustomer?.displayName || undefined,
          label: customerDraft.contactLabel.trim() || "customer",
          customerId: customerData.id,
          emails: customerDraft.contactEmail || customerDraft.email
            ? [{ email: customerDraft.contactEmail || customerDraft.email, type: "work" }]
            : [],
          phones: customerDraft.contactPhone || customerDraft.phone
            ? [{ phone: customerDraft.contactPhone || customerDraft.phone, type: "work" }]
            : [],
          addresses: customerDraft.address || customerDraft.city || customerDraft.zip
            ? [{
                street: customerDraft.address,
                city: customerDraft.city,
                state: customerDraft.state,
                zip: customerDraft.zip,
                type: "work",
              }]
            : [],
        }),
      });
      const contactData = await contactRes.json();
      if (!contactRes.ok) throw new Error(contactData.error || "Failed to create customer contact");

      const refreshedCompanies = await loadPageData();
      const createdCompany =
        refreshedCompanies?.find((company) => company.customerId === customerData.id) ?? null;
      setCustomerCompanyId(createdCompany?.id || "");
      setCustomerContactId(contactData.id);
      setCustomerDialogOpen(false);
      setCustomerDraft(emptyCustomerDraft);
      setAttachContactCustomerId(null);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to create customer" });
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function performMarkRfpSentOutside() {
    const id = markSentOutsideRfpId;
    if (!id) return;
    const wasEditing = activeDraftId === id;
    setMarkSentOutsideBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/rfp/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "sent" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not mark RFP as sent");
      setMarkSentOutsideRfpId(null);
      skipNextWipPersist.current = true;
      await loadPageData();
      if (wasEditing) {
        await loadSavedRfpIntoForm(id);
      }
      setResult({ success: true, markedSentOutside: true });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Could not mark RFP as sent" });
    } finally {
      setMarkSentOutsideBusy(false);
    }
  }

  async function performSendRfp() {
    setSending(true);
    setResult(null);
    const draftIdToDelete = activeDraftId;
    try {
      const validationError = validateRfpRequest();
      if (validationError) throw new Error(validationError);
      const response = await sendRfpRequest("send");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send RFP");

      const newRfpId = typeof data.rfpRequestId === "string" ? data.rfpRequestId : null;
      if (draftIdToDelete && newRfpId !== draftIdToDelete) {
        await fetch(`/api/rfp/${encodeURIComponent(draftIdToDelete)}`, { method: "DELETE" }).catch(() => {});
      }
      if (newRfpId) {
        await linkPendingWorkflowRowToRfp(newRfpId);
      }

      setResult({ success: true, sentTo: data.sentTo });
      skipNextWipPersist.current = true;
      localStorage.removeItem(RFP_WIP_STORAGE_KEY);
      flushSync(() => {
        setActiveDraftId(null);
        setReissueParentRfpId(null);
      });
      setBaselineFingerprint(rfpFormFingerprintRef.current);
      await loadPageData();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to send RFP" });
    } finally {
      setSending(false);
      setSendConfirmOpen(false);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateRfpRequest();
    if (validationError) {
      setResult({ error: validationError });
      return;
    }
    setSendConfirmOpen(true);
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setResult(null);
    try {
      const validationError = validateRfpRequest();
      if (validationError) throw new Error(validationError);
      const response = await sendRfpRequest("preview");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to build preview");
      setPreviewData(data);
      setPreviewOpen(true);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to build preview" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleTestSend() {
    setTestingEmail(true);
    setResult(null);
    setTestEmailFoundId(null);
    try {
      const validationError = validateRfpRequest();
      if (validationError) throw new Error(validationError);
      const response = await sendRfpRequest("test", { testEmail });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send test email");
      setRfpTestEmailOk(true);
      setResult({ success: true, testEmailSent: true });
      setPreviewOpen(false);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to send test email" });
    } finally {
      setTestingEmail(false);
    }
  }

  async function loadDriveFiles(kind: DrivePickerKind, options?: { query?: string; folderId?: string }) {
    setDrivePickerLoading(true);
    setDrivePickerError("");
    try {
      const params = new URLSearchParams({ kind });
      const query = options?.query ?? drivePickerQuery;
      const folderId = options?.folderId ?? driveCurrentFolderId;
      if (query.trim()) params.set("query", query.trim());
      if (folderId) params.set("folderId", folderId);
      const response = await fetch(`/api/google-drive/files?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load Google Drive files");
      setDriveFiles(Array.isArray(data.files) ? data.files : []);
      setDriveBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []);
      setDriveCurrentFolderId(typeof data.currentFolderId === "string" ? data.currentFolderId : "");
    } catch (error) {
      setDriveFiles([]);
      setDriveBreadcrumbs([]);
      setDrivePickerError(error instanceof Error ? error.message : "Failed to load Google Drive files");
    } finally {
      setDrivePickerLoading(false);
    }
  }

  function openDrivePicker(kind: DrivePickerKind) {
    setDrivePickerKind(kind);
    setDrivePickerQuery("");
    setDriveFiles([]);
    setDriveBreadcrumbs([]);
    setDriveCurrentFolderId("");
    setDriveSort("name");
    setDriveShareWorking(false);
    setDrivePickerOpen(true);
    void loadDriveFiles(kind, { query: "", folderId: "" });
  }

  async function handleDriveEntryActivate(file: DriveFileOption) {
    if (file.isFolder) {
      setDrivePickerQuery("");
      void loadDriveFiles(drivePickerKind, { query: "", folderId: file.id });
      return;
    }
    const fid = String(file.id || "").trim();
    if (!fid) {
      setDrivePickerError("This file has no Google Drive id. Choose another file or upload locally.");
      return;
    }
    setDriveShareWorking(true);
    setDrivePickerError("");
    try {
      const res = await fetch(`/api/google-drive/files/${encodeURIComponent(fid)}/share-with-link`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not update sharing for this file.");
      }
      const link =
        file.webViewLink?.trim() || (fid ? `https://drive.google.com/file/d/${fid}/view` : "");
      if (drivePickerKind === "bill") {
        if (link) {
          setBillDriveItems((prev) =>
            appendBillDriveItem(prev, { fileId: file.id, webViewLink: link, filename: file.name })
          );
        }
        setLocalBillFile(null);
      } else {
        setSummarySpreadsheetUrl(link);
        setSelectedSummaryDriveFileId(file.id);
        setLocalSummaryFile(null);
      }
      setDrivePickerOpen(false);
    } catch (err) {
      setDrivePickerError(err instanceof Error ? err.message : "Sharing update failed.");
    } finally {
      setDriveShareWorking(false);
    }
  }

  function handleLocalFileSelected(kind: DrivePickerKind, file: File | null) {
    if (kind === "bill") {
      setLocalBillFile(file);
      if (file) {
        setBillDriveItems([]);
      }
    } else {
      setLocalSummaryFile(file);
      if (file) {
        setSummarySpreadsheetUrl("");
        setSelectedSummaryDriveFileId("");
      }
    }
    setDrivePickerOpen(false);
  }

  function openSelectedDocument(kind: SelectedDocumentKind) {
    if (typeof window === "undefined") return;

    const localFile = kind === "bill" ? localBillFile : localSummaryFile;
    const url =
      kind === "bill" ? billDriveItems.find((b) => b.webViewLink.trim())?.webViewLink ?? "" : summarySpreadsheetUrl;

    if (localFile) {
      const objectUrl = URL.createObjectURL(localFile);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return;
    }

    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function fetchMeterSchedule() {
    setMeterLoading(true);
    setMeterNotice("");
    setMeterRows([]);
    try {
      const res = await fetch("/api/utilities/meter-read-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utility: meterUtility, accountNumber: meterAccount.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load meter read dates");
      setMeterRows(Array.isArray(data.months) ? data.months : []);
      setMeterNotice(typeof data.notice === "string" ? data.notice : "");
    } catch (e) {
      setMeterNotice(e instanceof Error ? e.message : "Request failed");
    } finally {
      setMeterLoading(false);
    }
  }

  async function sendRfpRequest(
    mode: "preview" | "test" | "send",
    extraFields?: Record<string, string>
  ) {
    const payload = buildRfpPayload(mode);
    const hasAttachments = Boolean(localBillFile || localSummaryFile);

    if (!hasAttachments) {
      return fetch("/api/rfp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...extraFields }),
      });
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries({ ...payload, ...extraFields })) {
      if (value === undefined) continue;
      formData.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    if (localBillFile) formData.append("billAttachment", localBillFile);
    if (localSummaryFile) formData.append("summaryAttachment", localSummaryFile);

    return fetch("/api/rfp/send", {
      method: "POST",
      body: formData,
    });
  }

  function buildRfpPayload(mode: "send" | "preview" | "test") {
    const et = energyType as EnergyType;
    const supplierContactSelections: Record<string, Array<{ contactId: string; email: string }>> = {};
    for (const sid of selectedSupplierIds) {
      const slots = selectedSupplierRecipients[sid]?.filter((s) => s.email.trim()) ?? [];
      if (slots.length > 0) {
        supplierContactSelections[sid] = slots.map((s) => ({
          contactId: s.contactId,
          email: s.email.trim(),
        }));
      }
    }
    const bp = loadBrokerProfile();
    return {
      mode,
      customerId: resolvedCustomerIdForValidation || "",
      customerContactId,
      energyType: et,
      supplierIds: selectedSupplierIds,
      ...(Object.keys(supplierContactSelections).length > 0
        ? { supplierContactSelections }
        : {}),
      requestedTerms,
      customTermMonths: customTermMonths || undefined,
      quoteDueDate: quoteDueDate || undefined,
      contractStartMonth: contractStartMonth || undefined,
      contractStartYear: contractStartYear || undefined,
      billDriveItems: billDriveItems.length > 0 ? billDriveItems : undefined,
      googleDriveFolderUrl: billDriveItems[0]?.webViewLink || undefined,
      summarySpreadsheetUrl: summarySpreadsheetUrl || undefined,
      summaryDriveFileId: selectedSummaryDriveFileId || undefined,
      billAttachmentName: localBillFile?.name || undefined,
      summaryAttachmentName: localSummaryFile?.name || undefined,
      ldcUtility: ldcUtility || undefined,
      brokerMargin: brokerMargin || undefined,
      brokerMarginUnit,
      brokerProfile: {
        firstName: bp.firstName,
        lastName: bp.lastName,
        companyName: bp.companyName,
        email: bp.email,
        phone: bp.phone,
        fax: bp.fax,
      },
      electricPricingOptions:
        et === "ELECTRIC"
          ? {
              selectedIds: electricPricing.selectedIds,
              fixedRateCapacityAdjustNote:
                electricPricing.fixedRateCapacityAdjustNote.trim() || undefined,
            }
          : undefined,
      notes: notes || undefined,
      accountLines: accountLines.map((line) => ({
        accountNumber: line.accountNumber,
        serviceAddress: line.serviceAddress || undefined,
        annualUsage: line.annualUsage,
        avgMonthlyUsage: line.avgMonthlyUsage,
      })),
      ...(mode === "send" && reissueParentRfpId ? { reissueParentRfpId } : {}),
      ...(enrollmentDetailsPayload ? { enrollmentDetails: enrollmentDetailsPayload } : {}),
    };
  }

    return (
    <div className="space-y-6">
      <div className="sticky top-0 z-40 -mx-1 border-b border-border/80 bg-background/95 px-2 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:px-3">
        <div className="mb-2 space-y-2">
          {draftNotice ? (
            <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
              <p className="min-w-0 flex-1 leading-snug">{draftNotice}</p>
              <button
                type="button"
                className="shrink-0 rounded-sm p-1 text-blue-900 hover:bg-blue-100 dark:text-blue-100 dark:hover:bg-blue-900/40"
                onClick={() => setDraftNotice(null)}
                aria-label="Dismiss notice"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {customerRfpLoadedBanner !== "hidden" ? (
            <div
              role="status"
              className={cn(
                "cursor-pointer select-none rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 shadow-sm transition-opacity duration-500 ease-out dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
                customerRfpLoadedBanner === "fading" ? "opacity-0" : "opacity-100"
              )}
              onClick={() => dismissCustomerRfpLoadedBanner()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dismissCustomerRfpLoadedBanner();
                }
              }}
              tabIndex={0}
              aria-label="Customer RFP loaded. Click to dismiss."
            >
              <p className="leading-snug">Customer RFP Loaded</p>
            </div>
          ) : null}
          {result?.success && result.testEmailSent ? (
            <div className="flex gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              <p className="min-w-0 flex-1 leading-snug">Test email sent.</p>
              <button
                type="button"
                className="shrink-0 rounded-sm p-1 text-green-800 hover:bg-green-100 dark:text-green-200 dark:hover:bg-green-900/40"
                onClick={() => setResult(null)}
                aria-label="Dismiss message"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {result?.success && result.markedSentOutside ? (
            <div className="flex gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              <p className="min-w-0 flex-1 leading-snug">
                RFP marked as sent. You can open <span className="font-medium">Quotes</span> to compare supplier
                pricing and continue the workflow.
              </p>
              <button
                type="button"
                className="shrink-0 rounded-sm p-1 text-green-800 hover:bg-green-100 dark:text-green-200 dark:hover:bg-green-900/40"
                onClick={() => setResult(null)}
                aria-label="Dismiss message"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {result?.success &&
          !result.testEmailSent &&
          !result.markedSentOutside &&
          typeof (result.emailRecipientCount ?? result.sentTo) === "number" ? (
            <div className="flex gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              <p className="min-w-0 flex-1 leading-snug">
                RFP sent to {result.emailRecipientCount ?? result.sentTo} email address
                {(result.emailRecipientCount ?? result.sentTo) === 1 ? "" : "es"}.
              </p>
              <button
                type="button"
                className="shrink-0 rounded-sm p-1 text-green-800 hover:bg-green-100 dark:text-green-200 dark:hover:bg-green-900/40"
                onClick={() => setResult(null)}
                aria-label="Dismiss message"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {result?.error ? (
            <div className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <div className="min-w-0 flex-1 space-y-2 leading-snug">
                <p>{result.error}</p>
                {isGoogleReconnectSuggestedMessage(result.error) ? (
                  <p className="text-xs font-normal">
                    <a
                      href={googleOAuthConnectUrl(loadBrokerProfile().email)}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Reconnect Google
                    </a>
                    {" — "}complete sign-in, then try again.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="shrink-0 rounded-sm p-1 text-destructive hover:bg-destructive/15"
                onClick={dismissResultError}
                aria-label="Dismiss message"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="shrink-0 text-lg font-bold tracking-tight sm:text-xl">RFP workspace</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setResetConfirmOpen(true)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
            <Button
              type="button"
              variant={isRfpDirty ? "default" : "outline"}
              size="sm"
              disabled={savingDraft}
              onClick={() => void saveDraftToServer()}
              className={cn(isRfpDirty && "shadow-sm ring-2 ring-primary/30")}
            >
              {savingDraft ? "Saving…" : "Save RFP"}
            </Button>
          </div>
          <div className="flex min-w-0 w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto sm:flex-1">
            <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={previewLoading}>
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              {previewLoading ? "Preview…" : "Preview email"}
            </Button>
            <Input
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Test email"
              className="h-8 w-[min(100%,11rem)] sm:w-44"
            />
            <Button type="button" variant="outline" size="sm" onClick={handleTestSend} disabled={testingEmail}>
              {testingEmail ? "Sending…" : "Test RFP"}
            </Button>
            {activeDraftId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={markSentOutsideBusy}
                onClick={() => setMarkSentOutsideRfpId(activeDraftId)}
                title="Use when supplier emails were already sent outside Energia"
              >
                {markSentOutsideBusy ? "Updating…" : "Mark sent (outside app)"}
              </Button>
            ) : null}
            {testEmailFoundId ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setTestEmailViewOpen(true)}>
                View test
              </Button>
            ) : rfpTestEmailOk ? (
              <span className="text-xs text-muted-foreground">Waiting for test delivery…</span>
            ) : null}
            <Button type="submit" form="rfp-workspace-form" size="sm" disabled={sending}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {sending ? "Sending…" : "Send RFP"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)] xl:items-start">
        <form id="rfp-workspace-form" onSubmit={handleSend} className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardDescription className="flex items-start gap-2 text-base text-foreground">
                <FileText className="mt-0.5 h-5 w-5 shrink-0" />
                <span>
                  Choose the customer company, energy type, requested terms, return date, and bill package.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="grid content-start gap-2">
                  <Label>Energy Type *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={energyType === "NATURAL_GAS" ? "default" : "outline"}
                      onClick={() => setEnergyType(energyType === "NATURAL_GAS" ? "" : "NATURAL_GAS")}
                    >
                      Natural Gas
                    </Button>
                    <Button
                      type="button"
                      variant={energyType === "ELECTRIC" ? "default" : "outline"}
                      onClick={() => setEnergyType(energyType === "ELECTRIC" ? "" : "ELECTRIC")}
                    >
                      Electric
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Choose one energy type for this RFP (required before suppliers appear).
                  </p>
                </div>
                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <div className="grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <Label className="shrink-0">Customer Company *</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setAttachContactCustomerId(null);
                          setCustomerDraft({
                            ...emptyCustomerDraft,
                            contactLabel: defaultCustomerContactLabels(energyType),
                          });
                          setCustomerDialogOpen(true);
                        }}
                      >
                        <UserPlus className="mr-1 h-3.5 w-3.5" />
                        Add customer
                      </Button>
                    </div>
                    <div className="relative">
                      <Input
                        ref={customerCompanyInputRef}
                        value={customerCompanySearch}
                        onFocus={() => setCustomerCompanyDropdownOpen(true)}
                        onBlur={() => window.setTimeout(() => setCustomerCompanyDropdownOpen(false), 120)}
                        onChange={(e) => {
                          setCustomerCompanySearch(e.target.value);
                          setCustomerCompanyDropdownOpen(true);
                          if (customerCompanyId) {
                            setCustomerCompanyId("");
                            setRfpExtraCustomerContact(null);
                          }
                        }}
                        placeholder={loading ? "Loading customer companies..." : "Type customer company name"}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setCustomerCompanyDropdownOpen((current) => !current);
                          customerCompanyInputRef.current?.focus();
                        }}
                        aria-label="Toggle customer company list"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      {customerCompanyDropdownOpen && (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
                          {filteredCustomerCompanies.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-muted-foreground">No customer companies match that search.</p>
                          ) : (
                            filteredCustomerCompanies.map((customer) => {
                              const isSelected = customer.id === customerCompanyId;
                              return (
                                <button
                                  key={customer.id}
                                  type="button"
                                  className={`w-full border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                                    isSelected ? "bg-primary/10 font-medium" : "hover:bg-muted/50"
                                  }`}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setCustomerCompanyId(customer.id);
                                    setCustomerCompanySearch(customer.displayName);
                                    setRfpExtraCustomerContact(null);
                                    setCustomerCompanyDropdownOpen(false);
                                  }}
                                >
                                  {`${customer.displayName}${
                                    Array.isArray(customer.contacts) && customer.contacts.length === 0
                                      ? " - no contact on file"
                                      : ""
                                  }`}
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Type to filter, or use the chevron to open the company list.
                    </p>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <Label>Customer contact *</Label>
                    <Select
                      value={customerContactId.trim() || undefined}
                      onValueChange={setCustomerContactId}
                      disabled={customerContactsForSelect.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer contact" />
                      </SelectTrigger>
                      <SelectContent>
                        {customerContactsForSelect.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {formatCustomerContactSelectLine(contact)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {selectedCustomerNeedsSetup && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Add a customer contact</p>
                  <p className="mt-1">
                    {selectedCustomer?.displayName || "This company"} does not have anyone listed under this company
                    yet. Add at least one contact so you can choose who receives quote summaries and supplier
                    communications.
                  </p>
                  <Button type="button" variant="outline" className="mt-3" onClick={openCustomerSetupDialog}>
                    Create customer + contact
                  </Button>
                </div>
              )}

              {resolvedCustomerIdForValidation ? (
                <div className="rounded-lg border border-border/60 bg-muted/15 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">Customer contract expirations</p>
                    <p className="text-xs text-muted-foreground">
                      Active and recently lapsed agreements for this customer (includes the last 30 days). Renewal
                      emails can pull account lines from saved RFP history.
                    </p>
                  </div>
                  {customerContractsReminderLoading ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                      Loading contracts…
                    </p>
                  ) : customerContractsReminder.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No matching contracts for this customer.</p>
                  ) : (
                    <ul className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
                      {customerContractsReminder.map((c) => {
                        const expK = contractExpirationKey(c.expirationDate);
                        const expD = expK ? new Date(`${expK}T12:00:00`) : null;
                        const expired = isPastContractExpiration(c.expirationDate) || Boolean(c.isRecentExpired);
                        return (
                          <li
                            key={c.id}
                            className={cn(
                              "space-y-2 rounded-md border px-3 py-2 text-sm",
                              expired
                                ? "border-dashed border-amber-700/50 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/25"
                                : "border-border/40 bg-background"
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="min-w-0 flex-1 font-medium">
                                {c.customer?.name ?? "Customer"} → {c.supplier?.name ?? "Supplier"}
                              </span>
                              {expired ? (
                                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                                  Expired
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {(c.energyType ?? "").replaceAll("_", " ")} ·{" "}
                              {expD ? expD.toLocaleDateString() : "—"}
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-8 text-xs"
                              onClick={() => setRenewalEmailContractId(c.id)}
                            >
                              Send email
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-1">
                <div className="grid gap-2">
                  <Label>LDC / utility *</Label>
                  <div className="relative">
                    <Input
                      ref={ldcUtilityInputRef}
                      value={ldcUtilitySearch}
                      onFocus={() => setLdcUtilityDropdownOpen(true)}
                      onBlur={() =>
                        window.setTimeout(() => {
                          setLdcUtilityDropdownOpen(false);
                          setLdcUtility(ldcUtilitySearch.trim());
                        }, 120)
                      }
                      onChange={(e) => {
                        setLdcUtilitySearch(e.target.value);
                        setLdcUtilityDropdownOpen(true);
                      }}
                      placeholder={loading ? "Loading…" : "Type or pick a utility / LDC"}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setLdcUtilityDropdownOpen((o) => !o);
                        ldcUtilityInputRef.current?.focus();
                      }}
                      aria-label="Toggle utility list"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {ldcUtilityDropdownOpen && (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
                        {UTILITY_OPTIONS.filter((u) => {
                          const q = ldcUtilitySearch.trim().toLowerCase();
                          if (!q) return true;
                          return u.toLowerCase().includes(q);
                        }).length === 0 ? (
                            <p className="px-3 py-2 text-sm text-muted-foreground">
                              Type a custom utility name — it will be saved when you leave this field.
                            </p>
                          ) : (
                            UTILITY_OPTIONS.filter((u) => {
                              const q = ldcUtilitySearch.trim().toLowerCase();
                              if (!q) return true;
                              return u.toLowerCase().includes(q);
                            }).map((utility) => (
                              <button
                                key={utility}
                                type="button"
                                className="w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setLdcUtility(utility);
                                  setLdcUtilitySearch(utility);
                                  setLdcUtilityDropdownOpen(false);
                                }}
                              >
                                {utility}
                              </button>
                            ))
                          )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Same style as customer company: type to filter, pick from the list, or enter a custom name.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Requested terms *</Label>
                <div className="flex flex-wrap gap-2">
                  {TERM_OPTIONS.map((term) => {
                    const active = requestedTerms.includes(term);
                    return (
                      <button
                        key={term}
                        type="button"
                        onClick={() => toggleRequestedTerm(term)}
                        className={`rounded-md border px-3 py-2 text-sm transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        {term === "NYMEX" ? "NYMEX" : `${term} months`}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-2 md:max-w-md">
                  <Label htmlFor="custom-term">Custom terms (months)</Label>
                  <Input
                    id="custom-term"
                    value={customTermMonths}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCustomTermMonths(v);
                      setCustomTermsError(validateCustomTermsInput(v) || "");
                    }}
                    placeholder="e.g. 18, 30, 48 — comma-separated whole numbers"
                  />
                  {customTermsError ? (
                    <p className="text-xs text-destructive">{customTermsError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Separate multiple custom lengths with commas.</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Contract start month / year *</Label>
                  <Input
                    type="month"
                    value={contractStartValue}
                    onChange={(e) => setContractStartValue(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the month picker to choose the contract start month and year.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Supplier quote due date *</Label>
                  <Input
                    type="date"
                    value={quoteDueDate}
                    onChange={(e) => setQuoteDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Bill PDF links (Google Drive) or local file *</Label>
                <p className="text-xs text-muted-foreground">
                  Add one Drive link per bill (e.g. multiple accounts). Browse appends each file you pick.
                </p>
                {billDriveItems.length > 0 ? (
                  <ul className="space-y-2">
                    {billDriveItems.map((item, idx) => (
                      <li
                        key={`${item.fileId || "url"}-${idx}-${item.webViewLink.slice(0, 24)}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Input
                          value={item.webViewLink}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBillDriveItems((prev) =>
                              prev.map((row, i) => (i === idx ? { webViewLink: v } : row))
                            );
                            if (v) setLocalBillFile(null);
                          }}
                          placeholder="https://drive.google.com/..."
                          className="min-w-0 flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={!item.webViewLink.trim()}
                          onClick={() => {
                            const u = item.webViewLink.trim();
                            if (u && typeof window !== "undefined") {
                              window.open(u, "_blank", "noopener,noreferrer");
                            }
                          }}
                        >
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={() => setBillDriveItems((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label={`Remove bill link ${idx + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => openDrivePicker("bill")}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Browse
                  </Button>
                  {localBillFile ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => openSelectedDocument("bill")}
                    >
                      View local file
                    </Button>
                  ) : null}
                </div>
                {localBillFile && (
                  <p className="text-xs text-muted-foreground">
                    Local file selected: {localBillFile.name}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <CardTitle className="flex-1 leading-tight">
                      {energyType === "ELECTRIC"
                        ? "Select suppliers — Electric"
                        : energyType === "NATURAL_GAS"
                          ? "Select suppliers — Natural Gas"
                          : "Select suppliers"}
                    </CardTitle>
                    <button
                      type="button"
                      className={cn(
                        "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground",
                        supplierSelectHelpOpen && "border-primary/40 bg-muted/60 text-foreground"
                      )}
                      aria-expanded={supplierSelectHelpOpen}
                      aria-controls="rfp-supplier-select-help"
                      aria-label="How supplier selection works"
                      onClick={() => setSupplierSelectHelpOpen((open) => !open)}
                    >
                      <HelpCircle className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {supplierSelectHelpOpen ? (
                    <div
                      id="rfp-supplier-select-help"
                      className="rounded-md border border-border/80 bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground"
                    >
                      <p>
                        Rows are directory suppliers that have at least one contact for this energy type: either{" "}
                        <span className="font-medium text-foreground">supplier</span> or{" "}
                        <span className="font-medium text-foreground">vendor</span> on the label together with{" "}
                        <span className="font-medium text-foreground">
                          {energyType === "ELECTRIC" ? "electric" : "gas"}
                        </span>
                        , or—when the contact is linked to the supplier in the directory—an energy-only label such as{" "}
                        <span className="font-medium text-foreground">
                          {energyType === "ELECTRIC" ? "electric" : "gas"}
                        </span>
                        . Uncheck a row to exclude that supplier from this campaign.
                      </p>
                      <p className="mt-2">
                        Use the contact menu to choose who receives this RFP. The{" "}
                        <span className="font-medium text-foreground">Primary</span> checkbox saves the priority flag and
                        adds a <span className="font-medium text-foreground">primary</span> label on that contact in the
                        directory (uncheck to remove). Choosing an email to receive the RFP adds an{" "}
                        <span className="font-medium text-foreground">rfp:email</span> label so that address is
                        pre-selected next time. The list is driven
                        by Contacts whose labels include <span className="font-medium text-foreground">supplier</span>{" "}
                        (or vendor) plus <span className="font-medium text-foreground">gas</span> /{" "}
                        <span className="font-medium text-foreground">electric</span>. Contacts with{" "}
                        <span className="font-medium text-foreground">supplier</span> and{" "}
                        <span className="font-medium text-foreground">retired</span> are omitted here. New rows are linked
                        into the supplier directory when you open or refresh this page. Add a contact with{" "}
                        <span className="font-medium text-foreground">New contact</span> or use{" "}
                        <span className="font-medium text-foreground">Refresh suppliers</span> after editing labels
                        elsewhere.
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={eligibleSuppliers.length === 0}
                    onClick={() => setSelectedSupplierIds(eligibleSuppliers.map((s) => s.id))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedSupplierIds([])}
                  >
                    Deselect all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={supplierDirectoryRefreshing}
                    onClick={() => void refreshSupplierRows()}
                  >
                    <RefreshCw
                      className={cn("mr-2 h-4 w-4", supplierDirectoryRefreshing && "animate-spin")}
                    />
                    {supplierDirectoryRefreshing ? "Refreshing…" : "Refresh suppliers"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {suppliersMissingEnergyLabels.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Supplier label follow-up needed</p>
                  <p className="mt-1">
                    These suppliers have contacts labeled as supplier but are still missing a `gas`
                    or `electric` label, so RFP targeting may be incomplete:
                  </p>
                  <p className="mt-2">
                    {suppliersMissingEnergyLabels.map((supplier) => supplier.name).join(", ")}
                  </p>
                </div>
              )}
              {eligibleSuppliers.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No suppliers are currently tagged for {energyType === "ELECTRIC" ? "electric" : "natural gas"}.
                </p>
              )}
              {eligibleSuppliers.length > 0 && (
                <div className="rounded-lg border">
                  <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,1.35fr)] gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1.45fr)_minmax(0,1.2fr)] sm:gap-3 sm:px-4 sm:text-xs">
                    <div className="text-center">Incl.</div>
                    <div>Supplier</div>
                    <div className="col-span-2 sm:col-span-1">Contact(s) to Receive the RFP</div>
                    <div className="hidden sm:block">Email</div>
                  </div>
                  {suppliersTableRows.map(({ supplier, contacts, selectedSlots }) => {
                    const included = selectedSupplierIds.includes(supplier.id);
                    const selectedEmails = selectedSlots.map((s) => s.email.trim()).filter(Boolean);
                    const emailSummary = selectedEmails.join(", ");
                    const slotKey = (cid: string, em: string) =>
                      `${cid}\t${em.trim().toLowerCase()}`;
                    const selectedSlotSet = new Set(selectedSlots.map((s) => slotKey(s.contactId, s.email)));
                    const triggerLabel =
                      selectedSlots.length === 0
                        ? "Select recipients…"
                        : selectedSlots.length === 1
                          ? selectedEmails[0] ?? "1 recipient"
                          : `${selectedSlots.length} recipients`;
                    return (
                      <div
                        key={supplier.id}
                        className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,1.35fr)] gap-2 border-b px-3 py-3 text-sm last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1.45fr)_minmax(0,1.2fr)] sm:gap-3 sm:px-4"
                      >
                        <div className="flex items-center justify-center pt-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input"
                            checked={included}
                            onChange={() => toggleSupplierIncluded(supplier.id)}
                            aria-label={`Include ${supplier.name} in RFP`}
                          />
                        </div>
                        <div className="min-w-0 flex items-center">
                          <p className={`truncate font-medium ${!included ? "text-muted-foreground line-through" : ""}`}>
                            {supplier.name}
                          </p>
                        </div>
                        <div className="min-w-0">
                          {contacts.length > 0 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 w-full justify-between font-normal"
                                  disabled={!included}
                                >
                                  <span className="truncate">{triggerLabel}</span>
                                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] w-max max-w-[min(100vw-2rem,28rem)] overflow-y-auto"
                                align="start"
                              >
                                {contacts.map((contact) => {
                                  const addrList = supplierContactDeliverableEmails(contact);
                                  const primaryHint = supplierContactIsMarkedPrimary(contact);
                                  const primaryChecked = supplierContactIsMarkedPrimary(contact);
                                  const primaryBusy = supplierContactPrimarySavingId === contact.id;
                                  return (
                                    <div
                                      key={contact.id}
                                      className="border-b border-border/60 last:border-b-0"
                                    >
                                      {addrList.length === 0 ? (
                                        <div className="px-2 py-2 text-xs text-muted-foreground">
                                          {contact.name} — no email on file
                                        </div>
                                      ) : (
                                        addrList.map((addr) => {
                                          const receiveChecked = selectedSlotSet.has(
                                            slotKey(contact.id, addr)
                                          );
                                          return (
                                            <DropdownMenuCheckboxItem
                                              key={`${contact.id}:${addr}`}
                                              className="gap-2 py-2.5"
                                              checked={receiveChecked}
                                              disabled={!included}
                                              onCheckedChange={(v) =>
                                                void toggleSupplierRecipientSlot(
                                                  supplier.id,
                                                  contact.id,
                                                  addr,
                                                  Boolean(v)
                                                )
                                              }
                                              onSelect={(e) => e.preventDefault()}
                                            >
                                              <span className="min-w-0 flex-1 truncate font-medium">
                                                {contact.name}
                                                {primaryHint ? " (primary)" : ""}
                                              </span>
                                              <span className="max-w-[58%] shrink-0 truncate text-left text-xs text-muted-foreground">
                                                {addr}
                                              </span>
                                            </DropdownMenuCheckboxItem>
                                          );
                                        })
                                      )}
                                      <label
                                        className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <input
                                          type="checkbox"
                                          className="h-3.5 w-3.5 rounded border-input"
                                          checked={primaryChecked}
                                          disabled={primaryBusy}
                                          onChange={(e) =>
                                            void persistSupplierContactPrimary(contact.id, e.target.checked)
                                          }
                                          aria-label={`Mark ${contact.name} as primary supplier contact`}
                                        />
                                        Primary
                                      </label>
                                    </div>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <p className="text-muted-foreground">—</p>
                          )}
                        </div>
                        <div className="flex min-w-0 items-center">
                          {selectedEmails.length > 0 ? (
                            <button
                              type="button"
                              className="max-w-full truncate text-left text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              onClick={() => setSupplierRfpEmailDialog(selectedEmails)}
                            >
                              {emailSummary}
                            </button>
                          ) : (
                            <p className="truncate text-sm text-muted-foreground">—</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    Utility accounts and usage
                  </CardTitle>
                  <CardDescription>
                    Enter one line per meter or utility account from the customer bills. Optional utility cycle,
                    SDI, meter reads, transition type, and Ohio meter lookup are on each row under Enrollment
                    timing….
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button type="button" variant="outline" onClick={() => setUtilityTableModalOpen(true)}>
                    <Table2 className="mr-2 h-4 w-4" />
                    Table for email
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {accountLines.map((line, index) => (
                <div key={line.id} className="rounded-lg border p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">Account {index + 1}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAccountTimingModalLineId(line.id)}
                      >
                        Enrollment timing…
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => removeAccountLine(line.id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="grid gap-2">
                      <Label>Account number *</Label>
                      <Input
                        value={line.accountNumber}
                        onChange={(e) => updateAccountLine(line.id, "accountNumber", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2 xl:col-span-2">
                      <Label>Service address</Label>
                      <Input
                        value={line.serviceAddress}
                        onChange={(e) => updateAccountLine(line.id, "serviceAddress", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Annual usage *</Label>
                      <Input
                        type="number"
                        value={line.annualUsage}
                        onChange={(e) => updateAccountLine(line.id, "annualUsage", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Average monthly usage *</Label>
                      <Input
                        type="number"
                        value={line.avgMonthlyUsage}
                        onChange={(e) => updateAccountLine(line.id, "avgMonthlyUsage", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" onClick={addAccountLine}>
                Add another utility account
              </Button>
            </CardContent>
          </Card>

          {energyType === "ELECTRIC" ? (
            <Card>
              <CardHeader>
                <CardTitle>Pricing options</CardTitle>
                <CardDescription>
                  Optional electric pricing notes for suppliers (included in the RFP email below the main table, before
                  your general notes).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {ELECTRIC_PRICING_OPTION_DEFS.map((def) =>
                    def.id === "fixed_rate_capacity_adjust" ? (
                      <div
                        key={def.id}
                        className="col-span-full flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
                      >
                        <label className="flex min-w-0 shrink-0 cursor-pointer items-center gap-2 text-sm sm:max-w-[min(100%,20rem)]">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-input"
                            checked={electricPricing.selectedIds.includes(def.id)}
                            onChange={(e) => toggleElectricPricingOption(def.id, e.target.checked)}
                          />
                          <span>{def.label}</span>
                        </label>
                        {electricPricing.selectedIds.includes("fixed_rate_capacity_adjust") ? (
                          <Input
                            id="rfp-fixed-cap-note"
                            className="min-w-0 flex-1"
                            aria-label="Note for fixed rate capacity adjust"
                            value={electricPricing.fixedRateCapacityAdjustNote}
                            onChange={(e) =>
                              setElectricPricing((p) => ({ ...p, fixedRateCapacityAdjustNote: e.target.value }))
                            }
                            placeholder="Note (required when this option is selected)"
                          />
                        ) : null}
                      </div>
                    ) : (
                      <label key={def.id} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-input"
                          checked={electricPricing.selectedIds.includes(def.id)}
                          onChange={(e) => toggleElectricPricingOption(def.id, e.target.checked)}
                        />
                        <span>{def.label}</span>
                      </label>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Broker margin
              </CardTitle>
              <CardDescription>
                Set the broker margin first, then open the calculator if you want to test scenarios.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="grid gap-2">
                  <Label>Broker margin *</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={brokerMargin}
                    onChange={(e) => setBrokerMargin(e.target.value)}
                    placeholder="e.g. 0.003500"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Margin unit *</Label>
                  <Select value={brokerMarginUnit} onValueChange={(value) => setBrokerMarginUnit(value as PriceUnit)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {marginUnitOptions(energyType).map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Total avg monthly usage</Label>
                  <Input value={formatNumber(totals.totalAvgMonthlyUsage)} readOnly />
                </div>
                <div className="grid gap-2">
                  <Label>Verify margin</Label>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => {
                      setCalculatorMargin(brokerMargin);
                      setMarginCalculatorOpen(true);
                    }}
                  >
                    <Calculator className="mr-2 h-4 w-4" />
                    Open margin calculator
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="rfp-notes">Notes for suppliers</Label>
                <textarea
                  id="rfp-notes"
                  className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Special load notes, timing requests, or instructions."
                />
              </div>

            </CardContent>
          </Card>
        </form>

        <div className="flex min-h-0 min-w-0 w-full flex-col gap-6 self-start xl:sticky xl:top-24 xl:min-h-0 xl:h-[calc(100dvh-7rem)] xl:max-h-[calc(100dvh-7rem)]">
          <PanelGroup
            direction="vertical"
            autoSaveId="energia-rfp-checklist-recent-split"
            className={cn(
              "flex min-w-0 flex-col",
              "min-h-[min(68dvh,560px)] max-xl:shrink-0",
              "xl:min-h-0 xl:flex-1"
            )}
          >
            <Panel defaultSize={38} minSize={18} className="min-h-0 flex flex-col">
              <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="shrink-0 py-3">
              <CardTitle className="text-lg font-bold tracking-tight sm:text-xl">Quick checklist</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 text-sm">
              <ChecklistItem checked={Boolean(customerCompanyId && customerContactId)}>
                Customer company and contact selected
              </ChecklistItem>
              <ChecklistItem checked={Boolean(energyType)}>
                Energy type selected ({energyType === "ELECTRIC" ? "Electric" : energyType === "NATURAL_GAS" ? "Natural gas" : "—"})
              </ChecklistItem>
              <ChecklistItem checked={selectedSupplierIds.length > 0}>
                {selectedSupplierIds.length > 0
                  ? `Suppliers selected (${selectedSupplierIds.length})`
                  : "At least one supplier selected"}
              </ChecklistItem>
              <ChecklistItem checked={Boolean(ldcUtility.trim())}>
                LDC / utility filled in ({ldcUtility.trim() || "—"})
              </ChecklistItem>
              <ChecklistItem checked={Boolean(termsChecklistSummary)}>
                Requested terms ({termsChecklistSummary || "—"})
              </ChecklistItem>
              <ChecklistItem checked={Boolean(contractStartValue)}>
                Contract start month / year
              </ChecklistItem>
              <ChecklistItem checked={Boolean(quoteDueDate)}>
                Supplier quote due date
              </ChecklistItem>
              <ChecklistItem checked={Boolean(brokerMargin.trim()) && Boolean(brokerMarginUnit)}>
                {brokerMargin.trim()
                  ? `Broker margin (${brokerMargin} ${brokerMarginUnit})`
                  : "Broker margin and unit"}
              </ChecklistItem>
              <ChecklistItem checked={Boolean(billDriveItems.length || localBillFile)}>
                Bill PDF linked
              </ChecklistItem>
              <ChecklistItem checked={accountLines.every((line) => line.accountNumber && line.annualUsage && line.avgMonthlyUsage)}>
                Utility account lines completed
              </ChecklistItem>
              <ChecklistItem checked={usageSummaryWhenMultiChecklistOk}>
                Multiple accounts: every line has account # and usage
              </ChecklistItem>
              <ChecklistItem checked={rfpTestEmailOk}>Test RFP email sent successfully</ChecklistItem>
            </CardContent>
          </Card>
            </Panel>

            <PanelResizeHandle className={RFP_CHECKLIST_RECENT_RESIZE_HANDLE_CLASS} />

            <Panel defaultSize={62} minSize={22} className="min-h-0 flex flex-col">
          <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-border/60 shadow-sm xl:min-h-[12rem]">
            <CardHeader className="shrink-0">
              <CardTitle>Recent RFPs</CardTitle>
              <CardDescription>
                Unsubmitted entries are saved from the form; submitted entries have had supplier emails sent.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain pr-1">
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">Unsubmitted</h3>
                    <p className="text-xs text-muted-foreground">
                      Saved with <span className="font-medium">Save RFP</span> before sending.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1 text-xs"
                    onClick={() => setRecentUnsubmittedExpanded((v) => !v)}
                    aria-expanded={recentUnsubmittedExpanded}
                  >
                    {recentUnsubmittedExpanded ? (
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    )}
                    {recentUnsubmittedExpanded ? "Collapse" : "Expand"}
                  </Button>
                </div>
                {draftRfqs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No saved RFPs yet.</p>
                )}
                {recentUnsubmittedExpanded
                  ? draftRfqs.map((rfp) => (
                      <div
                        key={rfp.id}
                        className={`rounded-lg border p-4 ${focusRfpId === rfp.id ? "border-primary bg-primary/5" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{rfpListCustomerTitle(rfp)}</p>
                            <p className="text-sm text-muted-foreground">
                              {rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"} · Draft
                            </p>
                          </div>
                          <span className="text-right text-xs text-muted-foreground">
                            <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground/85">
                              Quote due
                            </span>
                            {rfp.quoteDueDate ? new Date(rfp.quoteDueDate).toLocaleDateString() : "Not set"}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void loadSavedRfpIntoForm(rfp.id, { showCustomerRfpLoaded: true })}
                          >
                            Continue editing
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={markSentOutsideBusy}
                            onClick={() => setMarkSentOutsideRfpId(rfp.id)}
                            title="Use when supplier emails were already sent outside Energia"
                          >
                            Mark sent (outside app)
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive/10"
                            onClick={() =>
                              setDeleteRfpTarget({ id: rfp.id, title: rfpListCustomerTitle(rfp) })
                            }
                          >
                            <Trash2 className="mr-1 h-4 w-4 shrink-0" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))
                  : draftRfqs.map((rfp) => (
                      <div
                        key={rfp.id}
                        className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between ${focusRfpId === rfp.id ? "border-primary bg-primary/5" : ""}`}
                      >
                        <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-medium">{rfpListCompanyLine(rfp)}</span>
                          <span className="text-muted-foreground">{rfpContactPersonLine(rfp)}</span>
                          <span>{rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"}</span>
                          <span className="text-muted-foreground">
                            Due: {rfp.quoteDueDate ? new Date(rfp.quoteDueDate).toLocaleDateString() : "—"}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 text-xs"
                            onClick={() => void loadSavedRfpIntoForm(rfp.id, { showCustomerRfpLoaded: true })}
                          >
                            Continue editing
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={markSentOutsideBusy}
                            onClick={() => setMarkSentOutsideRfpId(rfp.id)}
                            title="Use when supplier emails were already sent outside Energia"
                          >
                            Mark sent
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-destructive border-destructive/40"
                            onClick={() =>
                              setDeleteRfpTarget({ id: rfp.id, title: rfpListCustomerTitle(rfp) })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
              </section>

              <section className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">Submitted</h3>
                    <p className="text-xs text-muted-foreground">
                      Active supplier outreach. <span className="font-medium">Edit as re-issue</span> copies this RFP into
                      the form as a new send. <span className="font-medium">Supplier email refresh</span> resends the
                      same supplier email with an &quot;RFP Refresh&quot; subject line.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1 text-xs"
                    onClick={() => setRecentSubmittedExpanded((v) => !v)}
                    aria-expanded={recentSubmittedExpanded}
                  >
                    {recentSubmittedExpanded ? (
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    )}
                    {recentSubmittedExpanded ? "Collapse" : "Expand"}
                  </Button>
                </div>
                {submittedRfqs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No submitted RFPs yet.</p>
                )}
                {recentSubmittedExpanded
                  ? submittedRfqs.map((rfp) => (
                  <div
                    key={rfp.id}
                    className={`rounded-lg border p-4 ${focusRfpId === rfp.id ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{rfpListCustomerTitle(rfp)}</p>
                        <p className="text-sm text-muted-foreground">
                          {rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"} · {rfp.status}
                        </p>
                        {(rfp.refreshSequence ?? 0) > 0 ? (
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mt-1">
                            Supplier email refreshed {rfp.refreshSequence}×
                          </p>
                        ) : null}
                      </div>
                      <span className="text-right text-xs text-muted-foreground">
                        <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground/85">
                          Quote due
                        </span>
                        {rfp.quoteDueDate ? formatLocaleDateFromStoredDay(rfp.quoteDueDate) : "Not set"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Suppliers: {rfp.suppliers.map((supplier) => supplier.name).join(", ") || "—"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Accounts: {rfp.accountLines.length} · Utility: {rfp.ldcUtility || "—"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void loadSavedRfpIntoForm(rfp.id)}
                      >
                        Edit as re-issue
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setRefreshSupplierModalRfp(rfp)}
                      >
                        <RefreshCw className="mr-1 h-4 w-4 shrink-0" />
                        Supplier email refresh
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const targets = collectSubmittedRfpSupplierFollowUpTargets(rfp, suppliers);
                          if (targets.length === 0) {
                            setResult({
                              error:
                                "No supplier email addresses on file for this RFP. Ensure each supplier has contacts with email, or open Edit as re-issue and confirm recipients before sending.",
                            });
                            return;
                          }
                          setResult(null);
                          setRfpFollowUpCompose(targets);
                        }}
                      >
                        <Mail className="mr-1 h-4 w-4 shrink-0" />
                        Follow-up email
                      </Button>
                      <Link
                        href={`/quotes?rfpRequestId=${rfp.id}`}
                        className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium"
                      >
                        Review quotes
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRecentRfpArchiveTarget(rfp)}
                      >
                        <Archive className="mr-1 h-4 w-4 shrink-0" />
                        Archive
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        onClick={() =>
                          setDeleteRfpTarget({ id: rfp.id, title: rfpListCustomerTitle(rfp) })
                        }
                      >
                        <Trash2 className="mr-1 h-4 w-4 shrink-0" />
                        Delete
                      </Button>
                    </div>
                  </div>
                  ))
                  : submittedRfqs.map((rfp) => (
                      <div
                        key={rfp.id}
                        className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between ${focusRfpId === rfp.id ? "border-primary bg-primary/5" : ""}`}
                      >
                        <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-medium">{rfpListCompanyLine(rfp)}</span>
                          <span className="text-muted-foreground">{rfpContactPersonLine(rfp)}</span>
                          <span>{rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"}</span>
                          <span className="text-muted-foreground">
                            Due:{" "}
                            {rfp.quoteDueDate ? formatLocaleDateFromStoredDay(rfp.quoteDueDate) : "—"}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => void loadSavedRfpIntoForm(rfp.id)}
                          >
                            Edit as re-issue
                          </Button>
                          <Button type="button" size="sm" variant="secondary" className="h-8 text-xs" asChild>
                            <Link href={`/quotes?rfpRequestId=${rfp.id}`}>Quotes</Link>
                          </Button>
                        </div>
                      </div>
                    ))}
              </section>

              <section className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">Archived</h3>
                    <p className="text-xs text-muted-foreground">
                      Historical RFPs removed from the active list. Open one to review details when preparing a new contract
                      cycle.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1 text-xs"
                    onClick={() => setRecentArchivedExpanded((v) => !v)}
                    aria-expanded={recentArchivedExpanded}
                  >
                    {recentArchivedExpanded ? (
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    )}
                    {recentArchivedExpanded ? "Collapse" : "Expand"}
                  </Button>
                </div>
                {archivedRfqs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No archived RFPs yet.</p>
                ) : recentArchivedExpanded ? (
                  archivedRfqs.map((rfp) => (
                    <div key={rfp.id} className="rounded-lg border border-dashed p-4 opacity-90">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{rfpListCustomerTitle(rfp)}</p>
                          <p className="text-sm text-muted-foreground">
                            {rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"} · {rfp.status}
                          </p>
                        </div>
                        <span className="text-right text-xs text-muted-foreground">
                          <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground/85">
                            Quote due
                          </span>
                          {rfp.quoteDueDate ? formatLocaleDateFromStoredDay(rfp.quoteDueDate) : "Not set"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void loadSavedRfpIntoForm(rfp.id)}
                        >
                          Open in form
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await fetch(`/api/rfp/${rfp.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ archive: false }),
                            });
                            await loadPageData();
                          }}
                        >
                          Unarchive
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  archivedRfqs.map((rfp) => (
                    <div
                      key={rfp.id}
                      className="flex flex-col gap-2 rounded-md border border-dashed px-3 py-2 text-xs opacity-90 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-medium">{rfpListCompanyLine(rfp)}</span>
                        <span className="text-muted-foreground">{rfpContactPersonLine(rfp)}</span>
                        <span>{rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"}</span>
                        <span className="text-muted-foreground">
                          Due:{" "}
                          {rfp.quoteDueDate ? formatLocaleDateFromStoredDay(rfp.quoteDueDate) : "—"}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8 text-xs"
                          onClick={() => void loadSavedRfpIntoForm(rfp.id)}
                        >
                          Open in form
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={async () => {
                            await fetch(`/api/rfp/${rfp.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ archive: false }),
                            });
                            await loadPageData();
                          }}
                        >
                          Unarchive
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </CardContent>
          </Card>
            </Panel>
          </PanelGroup>
        </div>
      </div>

      <Dialog open={supplierRfpEmailDialog != null} onOpenChange={(o) => !o && setSupplierRfpEmailDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>RFP recipient email addresses</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[60vh] list-inside list-disc space-y-1 overflow-y-auto break-all text-sm">
            {(supplierRfpEmailDialog ?? []).map((em) => (
              <li key={em}>{em}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setSupplierRfpEmailDialog(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={accountTimingModalLine != null}
        onOpenChange={(open) => {
          if (!open) setAccountTimingModalLineId(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {accountTimingModalLine && accountTimingModalOrdinal > 0
                ? `Enrollment timing — Account ${accountTimingModalOrdinal} (optional)`
                : "Enrollment timing (optional)"}
            </DialogTitle>
          </DialogHeader>
          {accountTimingModalLine ? (
            <div className="space-y-4 py-1">
              <p className="text-xs text-muted-foreground">
                Optional context for this account only. Nothing here is required to send the RFP.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2 md:col-span-2">
                  <Label>Utility cycle ID (from bill)</Label>
                  <Input
                    value={accountTimingModalLine.timing.utilityCycleId}
                    onChange={(e) =>
                      updateAccountLineTiming(
                        accountTimingModalLine.id,
                        "utilityCycleId",
                        e.target.value
                      )
                    }
                    placeholder="If unknown, use meter read dates below or Ohio lookup"
                  />
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label>Account / SDI number</Label>
                  <Input
                    value={accountTimingModalLine.timing.sdiAccountNumber}
                    onChange={(e) =>
                      updateAccountLineTiming(
                        accountTimingModalLine.id,
                        "sdiAccountNumber",
                        e.target.value
                      )
                    }
                    placeholder="May differ from the account number in the usage table"
                  />
                </div>
              </div>
              {!accountTimingModalLine.timing.utilityCycleId.trim() ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Last meter read date</Label>
                    <Input
                      type="date"
                      value={accountTimingModalLine.timing.lastMeterReadDate}
                      onChange={(e) =>
                        updateAccountLineTiming(
                          accountTimingModalLine.id,
                          "lastMeterReadDate",
                          e.target.value
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Next scheduled read date</Label>
                    <Input
                      type="date"
                      value={accountTimingModalLine.timing.nextScheduledReadDate}
                      onChange={(e) =>
                        updateAccountLineTiming(
                          accountTimingModalLine.id,
                          "nextScheduledReadDate",
                          e.target.value
                        )
                      }
                    />
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label>Transition type</Label>
                <Select
                  value={accountTimingModalLine.timing.transitionType || "__none__"}
                  onValueChange={(v) =>
                    updateAccountLineTiming(
                      accountTimingModalLine.id,
                      "transitionType",
                      v === "__none__" ? "" : v
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select transition type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Select —</SelectItem>
                    {TRANSITION_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {accountTimingModalLine.timing.transitionType ? (
                  <p className="text-xs text-muted-foreground leading-snug">
                    {
                      TRANSITION_TYPE_OPTIONS.find(
                        (o) => o.value === accountTimingModalLine?.timing.transitionType
                      )?.help
                    }
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Choose how the new supplier should time enrollment relative to meter reads and the prior
                    supplier.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-fit"
                  onClick={() => {
                    setMeterAccount(
                      (
                        accountTimingModalLine.timing.sdiAccountNumber ||
                        accountTimingModalLine.accountNumber ||
                        ""
                      ).trim()
                    );
                    setMeterModalOpen(true);
                  }}
                >
                  Meter read dates (Ohio utilities)
                </Button>
                <p className="text-xs text-muted-foreground">
                  AEP, Duke, FirstEnergy, Columbia Gas — uses SDI / account from above (see lookup modal for data
                  source notice).
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAccountTimingModalLineId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={marginCalculatorOpen} onOpenChange={setMarginCalculatorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Broker margin calculator</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label>Margin rate</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={calculatorMargin}
                  onChange={(e) => setCalculatorMargin(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Margin unit</Label>
                <Select value={brokerMarginUnit} onValueChange={(value) => setBrokerMarginUnit(value as PriceUnit)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {marginUnitOptions(energyType).map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Total avg monthly usage</Label>
                <Input value={formatNumber(totals.totalAvgMonthlyUsage)} readOnly />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {termsForCalculations(requestedTerms, customTermMonths).map((months) => (
                <div key={months} className="rounded-lg border bg-muted/40 p-4 space-y-2">
                  <p className="text-sm text-muted-foreground">{months}-month view</p>
                  <p className="text-sm">
                    Broker income:{" "}
                    <span className="font-semibold">
                      {formatCurrency(totals.totalAvgMonthlyUsage * months * toNumber(calculatorMargin))}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMarginCalculatorOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setBrokerMargin(calculatorMargin);
                setMarginCalculatorOpen(false);
              }}
            >
              Use this margin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={meterModalOpen}
        onOpenChange={(o) => {
          setMeterModalOpen(o);
          if (!o) {
            setMeterRows([]);
            setMeterNotice("");
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Meter read dates (Ohio utilities)</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Enter the customer&apos;s SDI / account number from the bill, pick the utility, then load dates.
            Production deployments should replace the stub API with audited utility data.
          </p>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Utility</Label>
              <Select
                value={meterUtility}
                onValueChange={(v) => setMeterUtility(v as typeof meterUtility)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AEP">AEP</SelectItem>
                  <SelectItem value="DUKE">Duke Energy</SelectItem>
                  <SelectItem value="FIRSTENERGY">FirstEnergy</SelectItem>
                  <SelectItem value="COLUMBIA">Columbia Gas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>SDI / account number</Label>
              <Input
                value={meterAccount}
                onChange={(e) => setMeterAccount(e.target.value)}
                placeholder="From customer bill"
              />
            </div>
            <Button
              type="button"
              disabled={meterLoading || !meterAccount.trim()}
              onClick={() => void fetchMeterSchedule()}
            >
              {meterLoading ? "Loading…" : "Load meter read dates"}
            </Button>
            {meterNotice ? (
              <p className="text-xs text-amber-800 dark:text-amber-200">{meterNotice}</p>
            ) : null}
            {meterRows.length > 0 ? (
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded border text-sm">
                {meterRows.map((row) => (
                  <li key={row.monthKey} className="border-b last:border-b-0">
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-muted/80"
                      onClick={() => {
                        setContractStartValue(row.monthKey);
                        setMeterModalOpen(false);
                      }}
                    >
                      <span className="font-medium tabular-nums">{row.monthKey}</span>
                      <span className="text-muted-foreground"> — {row.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMeterModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={sendConfirmOpen}
        onOpenChange={setSendConfirmOpen}
        title="Send RFP to suppliers?"
        message={`This sends one separate email to each address below (${sendConfirmRecipients.length} email address${sendConfirmRecipients.length === 1 ? "" : "es"}). This cannot be undone.`}
        confirmLabel="Send RFP"
        variant="default"
        onConfirm={() => void performSendRfp()}
      >
        {sendConfirmRecipients.length > 0 ? (
          <div className="mt-1 max-h-[min(50vh,22rem)] overflow-y-auto rounded-md border bg-muted/40 px-3 py-2">
            <ul className="space-y-3">
              {sendConfirmRecipients.map((r, i) => (
                <li
                  key={`${r.email}\0${i}`}
                  className="border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="font-medium text-foreground">{r.contactName}</div>
                  <div className="break-all text-muted-foreground">{r.email}</div>
                  <div className="text-xs text-muted-foreground">Supplier: {r.supplierName}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            No recipient addresses resolved—go back and fix supplier email selections.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset RFP page?"
        message="Clear all fields and local progress? Unsaved work in this form will be removed (saved drafts in the list stay in the database)."
        confirmLabel="Reset"
        variant="default"
        onConfirm={() => {
          clearLocalWipAndResetForm();
          setResetConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={markSentOutsideRfpId != null}
        onOpenChange={(o) => {
          if (!o && !markSentOutsideBusy) setMarkSentOutsideRfpId(null);
        }}
        title="Mark RFP as sent?"
        message="Use this when supplier emails were already sent outside Energia. The request will be treated as submitted (status “sent”) so you can use Quotes and workflow. No supplier emails are sent from Energia."
        confirmLabel={markSentOutsideBusy ? "Updating…" : "Mark as sent"}
        variant="default"
        onConfirm={() => void performMarkRfpSentOutside()}
      />

      <Dialog
        open={recentRfpArchiveTarget != null}
        onOpenChange={(o) => {
          if (!o && !recentRfpArchiveBusy) setRecentRfpArchiveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive RFP and quote work?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This hides the RFP from active lists, keeps all quote rows in the database, adds an Archives entry under
            Settings, and creates a contract stub (when a CRM customer is linked) for you to complete with executed
            terms.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRecentRfpArchiveTarget(null)}
              disabled={recentRfpArchiveBusy}
            >
              Cancel
            </Button>
            <Button type="button" disabled={recentRfpArchiveBusy} onClick={() => void confirmRecentRfpArchive()}>
              {recentRfpArchiveBusy ? "Archiving…" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteRfpTarget != null}
        onOpenChange={(o) => !o && !deleteRfpLoading && setDeleteRfpTarget(null)}
        title="Delete this RFP?"
        message={
          deleteRfpTarget
            ? `Remove “${deleteRfpTarget.title}” permanently? Account lines and calendar links tied to this request will be removed. Saved quotes may lose their link to this RFP.`
            : ""
        }
        confirmLabel={deleteRfpLoading ? "Deleting…" : "Delete"}
        onConfirm={async () => {
          if (!deleteRfpTarget) return;
          await deleteRfpById(deleteRfpTarget.id);
        }}
      />

      <Dialog
        open={refreshSupplierModalRfp != null}
        onOpenChange={(o) => {
          if (!o && !refreshSupplierSending) setRefreshSupplierModalRfp(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Refresh supplier pricing emails</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This resends the stored RFP email to each supplier on{" "}
            <span className="font-medium text-foreground">
              {refreshSupplierModalRfp ? rfpListCustomerTitle(refreshSupplierModalRfp) : ""}
            </span>
            . The subject line is prefixed with{" "}
            <span className="font-medium text-foreground">RFP Refresh</span> so recipients can distinguish follow-up
            requests when earlier quotes have expired.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="refresh-supplier-quote-due">New supplier quote due date</Label>
            <Input
              id="refresh-supplier-quote-due"
              type="date"
              value={refreshSupplierQuoteDueDate}
              onChange={(e) => setRefreshSupplierQuoteDueDate(e.target.value)}
              disabled={refreshSupplierSending}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRefreshSupplierModalRfp(null)}
              disabled={refreshSupplierSending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                refreshSupplierSending ||
                !refreshSupplierModalRfp ||
                !refreshSupplierQuoteDueDate.trim()
              }
              onClick={() => {
                const rfp = refreshSupplierModalRfp;
                if (!rfp) return;
                const due = refreshSupplierQuoteDueDate.trim();
                if (!due) return;
                void (async () => {
                  setRefreshSupplierSending(true);
                  setResult(null);
                  try {
                    const res = await fetch(`/api/rfp/${encodeURIComponent(rfp.id)}/refresh-suppliers`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ quoteDueDate: due }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      throw new Error(typeof data.error === "string" ? data.error : "Refresh failed");
                    }
                    setRefreshSupplierModalRfp(null);
                    await loadPageData();
                    const n =
                      typeof data.emailRecipientCount === "number"
                        ? data.emailRecipientCount
                        : typeof data.sentTo === "number"
                          ? data.sentTo
                          : null;
                    setDraftNotice(
                      n != null
                        ? `Supplier refresh emails sent to ${n} email address${n === 1 ? "" : "es"}.`
                        : "Supplier refresh completed."
                    );
                    window.setTimeout(() => setDraftNotice(null), 8000);
                  } catch (e) {
                    setResult({ error: e instanceof Error ? e.message : "Refresh failed" });
                  } finally {
                    setRefreshSupplierSending(false);
                  }
                })();
              }}
            >
              {refreshSupplierSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Sending…
                </>
              ) : (
                "Send refresh"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ComposeEmailModal
        to={rfpFollowUpCompose}
        sendSeparatelyPerRecipient
        title="Supplier follow-up"
        onClose={() => setRfpFollowUpCompose(null)}
        onSent={() => setRfpFollowUpCompose(null)}
      />

      <ContractRenewalEmailDialog
        open={renewalEmailContractId != null}
        onOpenChange={(o) => !o && setRenewalEmailContractId(null)}
        contractId={renewalEmailContractId}
      />

      <Dialog open={utilityTableModalOpen} onOpenChange={setUtilityTableModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Utility accounts (email preview)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This table matches what suppliers see in the RFP email. Copy from here if needed.
          </p>
          <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="p-2">Account #</th>
                    <th className="p-2">Service address</th>
                    <th className="p-2 text-right">Annual usage</th>
                    <th className="p-2 text-right">Avg monthly</th>
                  </tr>
                </thead>
                <tbody>
                  {accountLines.map((line) => (
                    <tr key={line.id} className="border-b">
                      <td className="p-2">{line.accountNumber || "—"}</td>
                      <td className="p-2">{line.serviceAddress || "—"}</td>
                      <td className="p-2 text-right">{line.annualUsage || "—"}</td>
                      <td className="p-2 text-right">{line.avgMonthlyUsage || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </DialogContent>
      </Dialog>

      <Dialog open={testEmailViewOpen} onOpenChange={setTestEmailViewOpen}>
        <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
            <DialogTitle>Test RFP email</DialogTitle>
            <p className="text-left text-sm font-normal text-muted-foreground">
              Scroll this window to see the full message. The inbox chrome is hidden so only the email is shown.
            </p>
          </DialogHeader>
          {testEmailFoundId ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <iframe
                title="Test RFP email"
                className="block h-[min(78vh,760px)] w-full min-h-[400px] border-0 bg-background"
                src={`/inbox/email/${encodeURIComponent(testEmailFoundId)}?embed=1`}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={drivePickerOpen} onOpenChange={setDrivePickerOpen}>
        <DialogContent className="max-w-[min(92vw,72rem)] w-[min(92vw,72rem)]">
          <DialogHeader>
            <DialogTitle>
              {drivePickerKind === "bill"
                ? "Add bill PDF from Google Drive"
                : "Select Usage Summary from Google Drive"}
            </DialogTitle>
            <DialogDescription>
              Selected files are set to <strong>anyone with the link can view</strong> so suppliers can open links
              from RFP emails without requesting access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {driveBreadcrumbs.length === 0 ? (
                <span className="text-sm text-muted-foreground">Loading folder path...</span>
              ) : (
                driveBreadcrumbs.map((crumb, index) => (
                  <button
                    key={crumb.id}
                    type="button"
                    className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setDrivePickerQuery("");
                      void loadDriveFiles(drivePickerKind, { query: "", folderId: crumb.id });
                    }}
                  >
                    {index > 0 && <ChevronRight className="mr-1 h-4 w-4" />}
                    {crumb.name}
                  </button>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                value={drivePickerQuery}
                onChange={(e) => setDrivePickerQuery(e.target.value)}
                placeholder="Search this folder"
              />
              <Button type="button" variant="outline" onClick={() => void loadDriveFiles(drivePickerKind)}>
                Search
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  (drivePickerKind === "bill" ? localBillInputRef : localSummaryInputRef).current?.click()
                }
              >
                <Upload className="mr-2 h-4 w-4" />
                Local file
              </Button>
              <Select value={driveSort} onValueChange={(value) => setDriveSort(value as "name" | "modified" | "size")}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort: Name</SelectItem>
                  <SelectItem value="modified">Sort: Date modified</SelectItem>
                  <SelectItem value="size">Sort: File size</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {driveShareWorking && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                Updating Google Drive sharing so anyone with the link can view…
              </div>
            )}
            {drivePickerError && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p>{drivePickerError}</p>
                {drivePickerError.toLowerCase().includes("insufficient permission") && (
                  <div className="mt-3">
                    <a
                      href="/api/gmail/connect"
                      className="inline-flex h-9 items-center justify-center rounded-md border border-amber-500 px-3 text-sm font-medium"
                    >
                      Reconnect Google with Drive access
                    </a>
                  </div>
                )}
              </div>
            )}
            <div className="max-h-[min(60vh,520px)] overflow-auto rounded-lg border">
              <div className="grid grid-cols-[minmax(12rem,2.6fr)_minmax(5rem,1fr)_minmax(6rem,1.1fr)_minmax(4rem,0.85fr)_4.5rem] gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:px-4 sm:text-xs">
                <div>Name</div>
                <div className="hidden sm:block">Owner</div>
                <div>Modified</div>
                <div className="text-right">Size</div>
                <div className="text-right">View</div>
              </div>
              {drivePickerLoading && <p className="text-sm text-muted-foreground">Loading Google Drive files...</p>}
              {!drivePickerLoading && sortedDriveFiles.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No matching files or folders found in this location.</p>
              )}
              {sortedDriveFiles.map((file) => (
                <div
                  key={file.id}
                  role="button"
                  tabIndex={0}
                  title={file.name}
                  className={cn(
                    "grid cursor-pointer grid-cols-[minmax(12rem,2.6fr)_minmax(5rem,1fr)_minmax(6rem,1.1fr)_minmax(4rem,0.85fr)_4.5rem] gap-x-3 gap-y-1 border-b px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:py-3",
                    driveShareWorking && "pointer-events-none opacity-50"
                  )}
                  onDoubleClick={() => void handleDriveEntryActivate(file)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleDriveEntryActivate(file);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    {renderDriveFileIcon(file)}
                    <div className="min-w-0">
                      <p className="break-words font-medium leading-snug" title={file.name}>
                        {file.name}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {file.isFolder ? "Folder · double-click to open" : formatDriveFileType(file)}
                      </p>
                    </div>
                    {file.isFolder ? <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                  </div>
                  <div className="hidden truncate text-sm text-muted-foreground sm:block" title={file.ownerName || undefined}>
                    {file.ownerName || "—"}
                  </div>
                  <div
                    className="truncate text-xs text-muted-foreground sm:text-sm"
                    title={file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : undefined}
                  >
                    {file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : "—"}
                  </div>
                  <div
                    className="text-right text-xs text-muted-foreground sm:text-sm"
                    title={file.isFolder ? undefined : formatFileSize(file.size)}
                  >
                    {file.isFolder ? "—" : formatFileSize(file.size)}
                  </div>
                  <div className="flex justify-end">
                    {!file.isFolder ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={driveShareWorking || (!file.webViewLink && !file.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          const url =
                            file.webViewLink?.trim() ||
                            (file.id ? `https://drive.google.com/file/d/${file.id}/view` : "");
                          if (!url || typeof window === "undefined") return;
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        View
                      </Button>
                    ) : (
                      <span className="text-muted-foreground"> </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <input
        ref={localBillInputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => {
          handleLocalFileSelected("bill", e.target.files?.[0] || null);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={localSummaryInputRef}
        type="file"
        accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          handleLocalFileSelected("summary", e.target.files?.[0] || null);
          e.currentTarget.value = "";
        }}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          overlayClassName="z-[100]"
          className="z-[100] flex h-[min(96dvh,calc(100dvh-1rem))] max-h-[min(96dvh,calc(100dvh-1rem))] w-[min(calc(100vw-1rem),80rem)] max-w-[min(calc(100vw-1rem),80rem)] flex-col gap-0 overflow-hidden border-2 border-border p-0 shadow-lg sm:rounded-lg left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]"
        >
          <DialogHeader className="shrink-0 space-y-1.5 border-b border-border bg-muted/30 px-4 py-3 text-left sm:px-5 sm:py-4">
            <DialogTitle className="text-base font-bold sm:text-lg pr-8">RFP email preview</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="shrink-0 rounded border border-border/80 bg-background p-2.5 text-xs sm:p-3 sm:text-sm">
                <p>
                  <span className="font-medium">Subject:</span>{" "}
                  <span className="font-bold">{previewData?.subject || "—"}</span>
                </p>
                <p className="mt-1">
                  <span className="font-medium">Previewing first supplier:</span>{" "}
                  {previewData?.recipientPreview[0]
                    ? `${previewData.recipientPreview[0].supplierName} - ${previewData.recipientPreview[0].contactName} (${previewData.recipientPreview[0].email})`
                    : "—"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  This preview shows the general email layout using the first selected supplier contact. Final send still delivers one private email per selected supplier contact.
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded border border-border bg-white p-2.5 text-[13px] leading-snug sm:p-3 [&_table]:text-[13px]">
                <div className="origin-top scale-[0.92] sm:scale-95">
                  <div dangerouslySetInnerHTML={{ __html: previewData?.html || "" }} />
                </div>
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-3 sm:px-5 sm:py-4">
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <Label>Test email address</Label>
                <Input
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div className="flex items-end">
                <Button type="button" onClick={handleTestSend} disabled={testingEmail}>
                  {testingEmail ? "Sending test..." : "Send test email"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={customerDialogOpen}
        onOpenChange={(open) => {
          setCustomerDialogOpen(open);
          if (!open) {
            setAttachContactCustomerId(null);
            setCustomerDraft(emptyCustomerDraft);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {attachContactCustomerId ? "Add contact for existing customer" : "Add customer and contact"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Customer name *</Label>
              <Input
                value={customerDraft.customerName}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, customerName: e.target.value }))}
                disabled={attachContactCustomerId != null}
              />
            </div>
            <div className="grid gap-2">
              <Label>Company</Label>
              <Input
                value={customerDraft.company}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, company: e.target.value }))}
                disabled={attachContactCustomerId != null}
              />
            </div>
            <div className="grid gap-2">
              <Label>Main email</Label>
              <Input
                value={customerDraft.email}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, email: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Main phone</Label>
              <PhoneInput
                value={customerDraft.phone}
                onChange={(v) => setCustomerDraft((current) => ({ ...current, phone: v }))}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Address</Label>
              <Input
                value={customerDraft.address}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, address: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>City</Label>
              <Input
                value={customerDraft.city}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, city: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>State</Label>
              <Input
                value={customerDraft.state}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, state: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>ZIP</Label>
              <Input
                value={customerDraft.zip}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, zip: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Customer contact name *</Label>
              <Input
                value={customerDraft.contactName}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, contactName: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Customer contact email</Label>
              <Input
                value={customerDraft.contactEmail}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, contactEmail: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Customer contact phone</Label>
              <PhoneInput
                value={customerDraft.contactPhone}
                onChange={(v) => setCustomerDraft((current) => ({ ...current, contactPhone: v }))}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <ContactLabelsField
                value={customerDraft.contactLabel}
                onChange={(contactLabel) => setCustomerDraft((current) => ({ ...current, contactLabel }))}
                presetLabels={contactLabelPresets}
                description="Include customer and the energy tag(s) (gas, electric, or both) so this person appears correctly in company picks and filters—same format as the Contacts page."
                idPrefix="rfp-add-customer-label"
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Notes</Label>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={customerDraft.notes}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCustomerDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateCustomer} disabled={creatingCustomer}>
                {creatingCustomer
                  ? attachContactCustomerId
                    ? "Creating contact..."
                    : "Creating..."
                  : attachContactCustomerId
                    ? "Create contact"
                    : "Create customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChecklistItem({
  checked,
  children,
}: {
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          checked
            ? "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {checked ? "✓" : "•"}
      </span>
      <span className={checked ? "text-foreground" : "text-muted-foreground"}>{children}</span>
    </div>
  );
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatNumber(value: number) {
  return value ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
}

function defaultMarginUnitForEnergy(energyType: EnergyType): PriceUnit {
  return energyType === "ELECTRIC" ? "KWH" : "MCF";
}

function marginUnitOptions(energyType: EnergyChoice): PriceUnit[] {
  if (energyType === "ELECTRIC") return ["KWH"];
  return ["MCF", "CCF", "DTH"];
}

function renderDriveFileIcon(file: DriveFileOption) {
  const className = "h-4 w-4 shrink-0";
  if (file.isFolder) return <Folder className={`${className} text-sky-500`} />;

  const name = file.name.toLowerCase();
  const mime = file.mimeType?.toLowerCase() || "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return <FileText className={`${className} text-red-500`} />;
  }
  if (mime.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(name)) {
    return <FileImage className={`${className} text-emerald-500`} />;
  }
  if (mime.includes("sheet") || mime.includes("excel") || /\.(csv|xlsx|xls)$/.test(name)) {
    return <FileSpreadsheet className={`${className} text-green-600`} />;
  }
  if (mime.includes("text") || name.endsWith(".txt")) {
    return <FileText className={`${className} text-slate-500`} />;
  }
  return <FileText className={`${className} text-muted-foreground`} />;
}

function formatDriveFileType(file: DriveFileOption) {
  const name = file.name.toLowerCase();
  const mime = file.mimeType?.toLowerCase() || "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (mime.startsWith("image/") || name.endsWith(".png")) return "PNG / Image";
  if (mime.includes("sheet") || mime.includes("excel") || /\.(csv|xlsx|xls)$/.test(name)) {
    return "Spreadsheet";
  }
  if (mime.includes("text") || name.endsWith(".txt")) return "Text";
  return file.mimeType || "File";
}

function formatFileSize(size?: number | null) {
  if (!size || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function termsForCalculations(requestedTerms: RequestedTerm[], customTermMonths: string) {
  const standardTerms = requestedTerms
    .filter((term): term is "12" | "24" | "36" => term !== "NYMEX")
    .map((term) => Number(term));
  const customParts = customTermMonths
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const combined = [...standardTerms, ...customParts];
  return Array.from(new Set(combined)).sort((a, b) => a - b);
}

function supplierContactIsMarkedPrimary(contact: { isPriority: boolean; label?: string | null }) {
  if (contact.isPriority) return true;
  return parseContactLabels(contact.label).some((t) => t.toLowerCase() === "primary");
}
