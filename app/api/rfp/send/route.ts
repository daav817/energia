import { NextRequest, NextResponse } from "next/server";
import { Prisma, CalendarEventType, EnergyType, PriceUnit, type Customer } from "@/generated/prisma/client";
import { getGmailClient, getGoogleDriveClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { flattenDeliverableSupplierContacts } from "@/lib/supplier-rfp-contacts";
import { localDateFromDayInput } from "@/lib/calendar-date";
import {
  type RfpBillDriveItem,
  normalizeRfpBillDriveItemsFromBody,
  formatBillLinksForEmailHtml,
  formatBillLinksForEmailText,
} from "@/lib/rfp-bill-drive-items";
import {
  type RfpElectricPricingOptionsState,
  formatElectricPricingForEmailHtml,
  formatElectricPricingForEmailText,
  normalizeElectricPricingFromBody,
} from "@/lib/rfp-electric-pricing-options";

type SendMode = "preview" | "test" | "send";
type Attachment = { filename: string; content: Buffer; mimeType: string };

/** Persisted inside `enrollmentDetails` so refresh/resend can rebuild the email signature. */
const RFP_BROKER_EMAIL_SIGNATURE_KEY = "rfpBrokerEmailSignature";

type RfpBrokerEmailSignature = {
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  fax: string;
};

function brokerProfileFromBody(body: Record<string, unknown>): unknown {
  return body.brokerProfile;
}

function normalizeBrokerEmailSignature(raw: unknown): RfpBrokerEmailSignature | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const p: RfpBrokerEmailSignature = {
    firstName: String(o.firstName ?? "").trim(),
    lastName: String(o.lastName ?? "").trim(),
    companyName: String(o.companyName ?? "").trim(),
    email: String(o.email ?? "").trim(),
    phone: String(o.phone ?? "").trim(),
    fax: String(o.fax ?? "").trim(),
  };
  return Object.values(p).some(Boolean) ? p : null;
}

function brokerSignatureFromEnrollmentJson(enrollment: unknown): RfpBrokerEmailSignature | null {
  if (!enrollment || typeof enrollment !== "object" || Array.isArray(enrollment)) return null;
  const raw = (enrollment as Record<string, unknown>)[RFP_BROKER_EMAIL_SIGNATURE_KEY];
  return normalizeBrokerEmailSignature(raw);
}

function mergeEnrollmentWithBrokerSignature(
  base: Prisma.InputJsonValue | undefined,
  broker: RfpBrokerEmailSignature | null
): Prisma.InputJsonValue | undefined {
  const hasBase = base !== undefined;
  const hasBroker = Boolean(broker);
  if (!hasBase && !hasBroker) return undefined;
  const obj =
    base && typeof base === "object" && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  if (broker) obj[RFP_BROKER_EMAIL_SIGNATURE_KEY] = broker;
  return obj as Prisma.InputJsonValue;
}

function uniqueRecipientEmailCount(recipients: Array<{ email: string }>): number {
  const seen = new Set<string>();
  for (const r of recipients) {
    const e = (r.email || "").trim().toLowerCase();
    if (e) seen.add(e);
  }
  return seen.size;
}

function enrollmentDetailsFromBody(body: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  const raw = body.enrollmentDetails;
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Prisma.InputJsonValue;
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) return j as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const { body, attachments } = await parseRequestPayload(request);
    const mode = normalizeSendMode(body.mode);
    const payload = await buildRfpPayload(body, attachments);

    if (mode === "preview") {
      const { html, text } = personalizeForFirstSupplierRecipient(payload);
      return NextResponse.json({
        success: true,
        subject: payload.subject,
        text,
        html,
        recipientPreview: payload.supplierRecipients.map((recipient) => ({
          supplierName: recipient.supplierName,
          contactName: recipient.contactName,
          email: recipient.email,
        })),
      });
    }

    const gmail = await getGmailClient();

    if (mode === "test") {
      const testEmail = nonEmptyString(body.testEmail);
      if (!testEmail) {
        return NextResponse.json({ error: "Enter a test email address" }, { status: 400 });
      }

      await ensureDriveFilesAccessible(payload, [testEmail]);

      const { html: testHtml, text: testText } = personalizeForFirstSupplierRecipient(payload);
      await sendMimeEmail(gmail, {
        to: [testEmail],
        subject: `[TEST] ${payload.subject}`,
        text: testText,
        html: testHtml,
        attachments: payload.attachments,
      });

      return NextResponse.json({ success: true, sentTo: 1, emailRecipientCount: 1, testEmail });
    }

    const quoteDue = localDateFromDayInput(payload.quoteDueDate ?? null);
    const primaryTermMonths =
      payload.termValues.find((value) => value.kind === "months")?.months ?? null;

    const reissueParentId = nonEmptyString(body.reissueParentRfpId);
    let parentRfpId: string | null = null;
    let refreshSequence = 0;
    if (reissueParentId) {
      const parentRow = await prisma.rfpRequest.findUnique({
        where: { id: reissueParentId },
        select: { id: true, refreshSequence: true },
      });
      if (parentRow) {
        parentRfpId = parentRow.id;
        refreshSequence = parentRow.refreshSequence + 1;
      }
    }

    const supplierContactSelections = supplierSelectionsFromBody(body);
    const brokerSig = normalizeBrokerEmailSignature(brokerProfileFromBody(body));
    const enrollmentDetails = mergeEnrollmentWithBrokerSignature(
      enrollmentDetailsFromBody(body),
      brokerSig
    );

    const rfpRequest = await prisma.rfpRequest.create({
      data: {
        customerId: isRfpUnlinkedPlaceholderCustomer(payload.customer.id)
          ? null
          : payload.customer.id,
        customerContactId: payload.customerContact.id,
        energyType: payload.energyType,
        annualUsage: new Prisma.Decimal(payload.totals.annualUsage),
        avgMonthlyUsage: new Prisma.Decimal(payload.totals.avgMonthlyUsage),
        termMonths: primaryTermMonths,
        googleDriveFolderUrl: payload.billDocumentUrl,
        billDriveItems:
          payload.billDriveItems.length > 0
            ? (payload.billDriveItems as Prisma.InputJsonValue)
            : Prisma.DbNull,
        electricPricingOptions:
          payload.electricPricing && payload.electricPricing.selectedIds.length > 0
            ? ({
                selectedIds: payload.electricPricing.selectedIds,
                fixedRateCapacityAdjustNote:
                  payload.electricPricing.fixedRateCapacityAdjustNote.trim() || undefined,
              } as Prisma.InputJsonValue)
            : Prisma.DbNull,
        summarySpreadsheetUrl: payload.usageSummaryUrl,
        quoteDueDate: quoteDue,
        contractStartMonth: payload.contractStartMonth,
        contractStartYear: payload.contractStartYear,
        brokerMargin:
          payload.brokerMargin === null ? null : new Prisma.Decimal(payload.brokerMargin),
        brokerMarginUnit: payload.brokerMarginUnit,
        ldcUtility: payload.ldcUtility,
        requestedTerms: payload.termValues,
        ...(supplierContactSelections ? { supplierContactSelections } : {}),
        ...(enrollmentDetails !== undefined ? { enrollmentDetails } : {}),
        notes: payload.notes,
        status: "sent",
        sentAt: new Date(),
        ...(parentRfpId ? { parentRfpId } : {}),
        refreshSequence,
        suppliers: {
          connect: payload.suppliers.map((supplier) => ({ id: supplier.id })),
        },
        accountLines: {
          create: payload.accountLines.map((line, index) => ({
            accountNumber: line.accountNumber,
            serviceAddress: line.serviceAddress,
            annualUsage: new Prisma.Decimal(line.annualUsage),
            avgMonthlyUsage: new Prisma.Decimal(line.avgMonthlyUsage),
            sortOrder: index,
          })),
        },
      },
    });

    if (quoteDue) {
      await prisma.calendarEvent.create({
        data: {
          title: `Supplier quote due — RFP (${payload.customer.name})`,
          description: [
            `Energy type: ${formatEnergyType(payload.energyType)}`,
            payload.ldcUtility ? `Utility: ${payload.ldcUtility}` : "",
            `Suppliers: ${payload.suppliers.map((supplier) => supplier.name).join(", ")}`,
            payload.billDriveItems.length > 0
              ? `Bill PDF links:\n${payload.billDriveItems.map((i) => i.webViewLink).join("\n")}`
              : payload.billDocumentUrl
                ? `Bills folder: ${payload.billDocumentUrl}`
                : "",
          ]
            .filter(Boolean)
            .join("\n"),
          startAt: quoteDue,
          allDay: true,
          eventType: CalendarEventType.SUPPLIER_QUOTE_DUE_RFP,
          customerId: isRfpUnlinkedPlaceholderCustomer(payload.customer.id)
            ? null
            : payload.customer.id,
          contactId: payload.customerContact.id,
          rfpRequestId: rfpRequest.id,
        },
      });
    }

    await ensureDriveFilesAccessible(
      payload,
      payload.supplierRecipients.map((recipient) => recipient.email)
    );

    for (const recipient of payload.supplierRecipients) {
      const greet = rfpSupplierGreeting(recipient);
      await sendMimeEmail(gmail, {
        to: [recipient.email],
        subject: payload.subject,
        text: payload.emailText.replace(/\{\{supplierContactName\}\}/g, greet),
        html: personalizeEmailHtml(payload.emailHtml, greet, recipient.supplierName),
        attachments: payload.attachments,
      });
    }

    const emailRecipientCount = uniqueRecipientEmailCount(payload.supplierRecipients);
    return NextResponse.json({
      success: true,
      rfpRequestId: rfpRequest.id,
      sentTo: emailRecipientCount,
      emailRecipientCount,
      suppliers: payload.supplierRecipients.map((recipient) => recipient.supplierName),
    });
  } catch (err) {
    console.error("RFP send error:", err);
    const message = err instanceof Error ? err.message : "Failed to send RFP";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function parseRequestPayload(request: NextRequest): Promise<{
  body: Record<string, unknown>;
  attachments: Attachment[];
}> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return { body: await request.json(), attachments: [] };
  }

  const formData = await request.formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue;
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    try {
      body[key] = JSON.parse(trimmed);
    } catch {
      body[key] = trimmed;
    }
  }

  const attachments: Attachment[] = [];
  for (const key of ["billAttachment", "summaryAttachment"]) {
    const file = formData.get(key);
    if (!(file instanceof File) || file.size === 0) continue;
    attachments.push({
      filename: file.name,
      content: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "application/octet-stream",
    });
  }

  return { body, attachments };
}

type RfpRecipientSlot = { contactId: string; email: string };

function parseRecipientSlotsFromJsonValue(value: unknown): RfpRecipientSlot[] {
  if (!Array.isArray(value)) return [];
  const out: RfpRecipientSlot[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ contactId: t, email: "" });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const cid = String(o.contactId ?? "").trim();
      const em = String(o.email ?? "").trim();
      if (cid) out.push({ contactId: cid, email: em });
    }
  }
  return out;
}

function normalizeSupplierContactSelectionValue(value: unknown): string[] {
  const slots = parseRecipientSlotsFromJsonValue(value);
  if (slots.length === 0) {
    if (typeof value === "string") {
      const t = value.trim();
      return t ? [t] : [];
    }
    if (Array.isArray(value)) {
      return value.map(String).map((s) => s.trim()).filter(Boolean);
    }
  }
  return slots.map((s) => s.contactId).filter(Boolean);
}

function recipientSlotsFromBody(body: Record<string, unknown>): RfpRecipientSlot[] {
  const supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds.map(String) : [];
  const slots: RfpRecipientSlot[] = [];
  const rawSelections = body.supplierContactSelections;
  if (rawSelections && typeof rawSelections === "object" && !Array.isArray(rawSelections)) {
    for (const sid of supplierIds) {
      slots.push(...parseRecipientSlotsFromJsonValue((rawSelections as Record<string, unknown>)[sid]));
    }
  }
  if (slots.length === 0 && Array.isArray(body.supplierRecipientSlots)) {
    slots.push(...parseRecipientSlotsFromJsonValue(body.supplierRecipientSlots));
  }
  if (slots.length === 0) {
    const supplierContactIds = Array.isArray(body.supplierContactIds)
      ? body.supplierContactIds.map(String)
      : [];
    for (let i = 0; i < supplierIds.length; i++) {
      const c = supplierContactIds[i]?.trim();
      if (c) slots.push({ contactId: c, email: "" });
    }
  }
  return slots;
}

function supplierSelectionsFromBody(
  body: Record<string, unknown>
): Record<string, RfpRecipientSlot[]> | null {
  const supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds.map(String) : [];
  if (supplierIds.length === 0) return null;

  const map: Record<string, RfpRecipientSlot[]> = {};
  const rawSelections = body.supplierContactSelections;
  if (rawSelections && typeof rawSelections === "object" && !Array.isArray(rawSelections)) {
    for (const sid of supplierIds) {
      const part = parseRecipientSlotsFromJsonValue((rawSelections as Record<string, unknown>)[sid]);
      if (part.length > 0) map[sid] = part;
    }
  }

  const supplierContactIds = Array.isArray(body.supplierContactIds)
    ? body.supplierContactIds.map(String)
    : [];

  if (Object.keys(map).length === 0) {
    for (let i = 0; i < supplierIds.length; i++) {
      const c = supplierContactIds[i]?.trim();
      if (c) map[supplierIds[i]] = [{ contactId: c, email: "" }];
    }
  } else {
    for (let i = 0; i < supplierIds.length; i++) {
      const sid = supplierIds[i];
      const c = supplierContactIds[i]?.trim();
      if (c && (!map[sid] || map[sid].length === 0)) {
        map[sid] = [{ contactId: c, email: "" }];
      }
    }
  }

  return Object.keys(map).length > 0 ? map : null;
}

function formatBrokerMarginForEmail(margin: number, unit: PriceUnit | string | undefined): string {
  const u = unit != null ? String(unit).trim() : "";
  let amt = margin.toFixed(6);
  amt = amt.replace(/(\.\d*?[1-9])0+$/, "$1");
  amt = amt.replace(/\.0+$/, "");
  return u ? `$${amt}/${u}` : `$${amt}`;
}

function buildRfpBrokerSignatureLines(p: RfpBrokerEmailSignature | null | undefined): string[] {
  if (!p) return [];
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return [name, p.companyName, p.phone, p.fax, p.email].map((x) => (x || "").trim()).filter(Boolean);
}

function buildRfpEmailBody(opts: {
  customer: { name: string; company: string | null };
  customerContact: { name: string; email: string | null; phone: string | null };
  energyType: string;
  requestedTerms: Array<{ kind: "months"; months: number } | { kind: "nymex" }>;
  quoteDueDate?: string;
  contractStartMonth?: number;
  contractStartYear?: number;
  billDriveItems?: RfpBillDriveItem[];
  usageSummaryUrl?: string | null;
  billAttachmentName?: string | null;
  usageSummaryAttachmentName?: string | null;
  ldcUtility?: string;
  brokerMargin?: number | null;
  brokerMarginUnit?: PriceUnit | string;
  accountLines: Array<{
    accountNumber: string;
    serviceAddress: string | null;
    annualUsage: number;
    avgMonthlyUsage: number;
  }>;
  notes?: string;
  brokerProfile?: RfpBrokerEmailSignature | null;
  electricPricing?: RfpElectricPricingOptionsState | null;
}): { text: string; html: string } {
  const contractStart = formatContractStart(opts.contractStartMonth, opts.contractStartYear);
  const usageSummaryLines = opts.accountLines.map((line) =>
    [
      line.accountNumber ? `Account Num. (${line.accountNumber})` : "",
      line.serviceAddress ? `Address: ${line.serviceAddress}` : "",
      `Annual usage is approx. ${formatUsage(line.annualUsage)}.`,
      `Average monthly usage is approx. ${formatUsage(line.avgMonthlyUsage)}.`,
    ]
      .filter(Boolean)
      .join("<br />")
  );
  const usageSummaryText = opts.accountLines
    .map((line) =>
      [
        `Account Num. (${line.accountNumber})`,
        line.serviceAddress ? `Address: ${line.serviceAddress}` : "",
        `Annual usage is approx. ${formatUsage(line.annualUsage)}.`,
        `Average monthly usage is approx. ${formatUsage(line.avgMonthlyUsage)}.`,
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join("\n");

  const energyLabel = formatEnergyType(opts.energyType);
  const marginCore =
    opts.brokerMargin != null
      ? formatBrokerMarginForEmail(opts.brokerMargin, opts.brokerMarginUnit)
      : "To be provided with quoted price";
  const marginCell =
    opts.brokerMargin != null
      ? `${marginCore} (please include this into the quoted price)`
      : marginCore;
  const hasDriveBills = Boolean(opts.billDriveItems && opts.billDriveItems.length > 0);
  const driveHtml = hasDriveBills ? formatBillLinksForEmailHtml(opts.billDriveItems!) : "";
  const attachHtml = opts.billAttachmentName
    ? `Attached file: ${escapeHtml(opts.billAttachmentName)}`
    : "";
  let billReference = "—";
  if (hasDriveBills && attachHtml) billReference = `${driveHtml}<br />${attachHtml}`;
  else if (hasDriveBills) billReference = driveHtml;
  else if (attachHtml) billReference = attachHtml;
  /** Spreadsheet link / attachment replaces the in-email usage table. */
  const externalUsageOnly = Boolean(opts.usageSummaryUrl || opts.usageSummaryAttachmentName);

  const sigLines = buildRfpBrokerSignatureLines(opts.brokerProfile);
  const signatureHtml =
    sigLines.length > 0
      ? `<p style="margin-top: 22px;">${sigLines
          .map((line) =>
            line.includes("@") && !/\s/.test(line)
              ? `<a href="mailto:${escapeHtml(line)}">${escapeHtml(line)}</a>`
              : escapeHtml(line)
          )
          .join("<br />\n        ")}</p>`
      : `<p style="margin-top: 22px;">—</p>`;

  const rows = [
    ["Energy Type", energyLabel],
    ["Local Distribution Center", opts.ldcUtility || "—"],
    ["Customer Name", opts.customer.name],
    ["Contract Length Requested", opts.requestedTerms.map(formatRequestedTerm).join(", ")],
    ["Contract Starting Month/Year", contractStart || "—"],
    ["Broker Margin", marginCell],
    [`Customer’s ${energyLabel} Bills for pricing`, billReference],
  ];

  const utilityAccountsTableHtml =
    !externalUsageOnly && opts.accountLines.length > 0
      ? `
      <p style="margin: 20px 0 8px;"><strong>Utility accounts &amp; usage</strong></p>
      <table style="border-collapse: collapse; width: 100%; max-width: 760px;">
        <thead>
          <tr>
            <th style="border: 1px solid #111; padding: 8px; text-align: left;">Account #</th>
            <th style="border: 1px solid #111; padding: 8px; text-align: left;">Service address</th>
            <th style="border: 1px solid #111; padding: 8px; text-align: right;">Annual usage</th>
            <th style="border: 1px solid #111; padding: 8px; text-align: right;">Avg monthly</th>
          </tr>
        </thead>
        <tbody>
          ${opts.accountLines
            .map(
              (line) => `
            <tr>
              <td style="border: 1px solid #111; padding: 8px; vertical-align: top;">${escapeHtml(line.accountNumber)}</td>
              <td style="border: 1px solid #111; padding: 8px; vertical-align: top;">${escapeHtml(line.serviceAddress || "—")}</td>
              <td style="border: 1px solid #111; padding: 8px; vertical-align: top; text-align: right;">${escapeHtml(formatUsage(line.annualUsage))}</td>
              <td style="border: 1px solid #111; padding: 8px; vertical-align: top; text-align: right;">${escapeHtml(formatUsage(line.avgMonthlyUsage))}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`.trim()
      : "";

  const electricPricingHtml = formatElectricPricingForEmailHtml(opts.electricPricing ?? null);

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #111; line-height: 1.4;">
      <p style="font-size: 28px; margin: 0 0 8px;"><strong>${escapeHtml(opts.customer.name)} | ${escapeHtml(energyLabel)} Quote</strong></p>
      <p style="margin: 0 0 18px;">Date Submitted: <strong>${escapeHtml(formatDisplayDate(new Date().toISOString()))}</strong></p>
      <p>Hi {{supplierContactName}},</p>
      <p>Please provide a quote for this customer on the following date: <strong>${escapeHtml(formatDisplayDate(opts.quoteDueDate || ""))}</strong>.</p>
      <p style="margin-top: 28px;"><strong>Pricing Terms and Customer Information:</strong></p>
      <table style="border-collapse: collapse; width: 100%; max-width: 760px;">
        <tbody>
          ${rows
            .map(
              ([label, value]) => `
                <tr>
                  <td style="border: 1px solid #111; padding: 8px; width: 32%; vertical-align: top;">${label}</td>
                  <td style="border: 1px solid #111; padding: 8px; vertical-align: top;">${value}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
      ${utilityAccountsTableHtml}
      ${electricPricingHtml ? `${electricPricingHtml}\n      ` : ""}
      ${opts.notes ? `<p style="margin-top: 18px;">${escapeHtml(opts.notes)}</p>` : ""}
      <p style="margin-top: 18px;">If you have any questions about this request, please contact me.</p>
      <p>Thank you!</p>
      ${signatureHtml}
    </div>
  `.trim();

  const textLines: string[] = [
    `${opts.customer.name} | ${energyLabel} Quote`,
    `Date Submitted: ${formatDisplayDate(new Date().toISOString())}`,
    "",
    "Hi {{supplierContactName}},",
    "",
    `Please provide a quote for this customer on the following date: ${formatDisplayDate(opts.quoteDueDate || "")}.`,
    "",
    "Pricing Terms and Customer Information:",
    `Energy Type: ${energyLabel}`,
    `Local Distribution Center: ${opts.ldcUtility || "—"}`,
    `Customer Name: ${opts.customer.name}`,
    `Contract Length Requested: ${opts.requestedTerms.map(formatRequestedTerm).join(", ")}`,
    `Contract Starting Month/Year: ${contractStart || "—"}`,
    `Broker Margin: ${marginCore}`,
    `Customer’s ${energyLabel} Bills for pricing: ${
      hasDriveBills || opts.billAttachmentName
        ? [
            ...(hasDriveBills ? [formatBillLinksForEmailText(opts.billDriveItems!)] : []),
            ...(opts.billAttachmentName ? [`Attached file: ${opts.billAttachmentName}`] : []),
          ].join("\n")
        : "—"
    }`,
  ];
  if (!externalUsageOnly) {
    textLines.push(
      usageSummaryText,
      "",
      "Utility accounts & usage (table):",
      ...opts.accountLines.map(
        (line) =>
          `  ${line.accountNumber} | ${line.serviceAddress || "—"} | annual ${formatUsage(line.annualUsage)} | avg mo ${formatUsage(line.avgMonthlyUsage)}`
      ),
      ""
    );
  }
  const electricPricingText = formatElectricPricingForEmailText(opts.electricPricing ?? null);
  if (electricPricingText) {
    textLines.push(electricPricingText, "");
  }
  textLines.push(
    opts.notes || "",
    "If you have any questions about this request, please contact me.",
    "",
    "Thank you!",
    "",
    ...(sigLines.length > 0 ? sigLines : ["—"]),
  );

  return { text: textLines.filter(Boolean).join("\n"), html };
}

function createMimeMessage(opts: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
}): string {
  const attachments = opts.attachments || [];
  const altBoundary = `----=_Part_${Date.now()}_alt`;
  const altLines: string[] = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.text, "utf-8").toString("base64"),
  ];
  if (opts.html) {
    altLines.push(
      `--${altBoundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(opts.html, "utf-8").toString("base64")
    );
  }
  altLines.push(`--${altBoundary}--`);

  const baseHeaders = [
    `To: ${opts.to.join(", ")}`,
    opts.cc.length ? `Cc: ${opts.cc.join(", ")}` : "",
    opts.bcc.length ? `Bcc: ${opts.bcc.join(", ")}` : "",
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  if (attachments.length === 0) {
    return [
      ...baseHeaders,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      altLines.join("\r\n"),
    ].join("\r\n");
  }

  const mixedBoundary = `----=_Part_${Date.now()}_mixed`;
  const mixedLines: string[] = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    altLines.join("\r\n"),
  ];

  for (const attachment of attachments) {
    mixedLines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mimeType}; name="${escapeHeaderValue(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${escapeHeaderValue(attachment.filename)}"`,
      "",
      attachment.content.toString("base64")
    );
  }

  mixedLines.push(`--${mixedBoundary}--`);

  return [
    ...baseHeaders,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    mixedLines.join("\r\n"),
  ].join("\r\n");
}

/** Placeholder id when building RFP content from Contacts only (no CRM Customer row). */
const RFP_UNLINKED_CUSTOMER_ID = "__rfp_unlinked_customer__";

function isRfpUnlinkedPlaceholderCustomer(id: string): boolean {
  return id === RFP_UNLINKED_CUSTOMER_ID;
}

function previewCustomerFromContact(row: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  customerId: string | null;
}): Customer {
  const displayName = (row.company?.trim() || row.name?.trim() || "Customer").trim();
  const now = new Date();
  return {
    id: RFP_UNLINKED_CUSTOMER_ID,
    name: displayName,
    company: row.company?.trim() || null,
    email: row.email,
    phone: row.phone,
    address: null,
    city: null,
    state: null,
    zip: null,
    notes: null,
    hasElectric: false,
    hasNaturalGas: false,
    googleContactId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function buildRfpPayload(body: Record<string, unknown>, attachments: Attachment[] = []) {
  let customerId = String(body.customerId || "").trim();
  const customerContactId = String(body.customerContactId || "").trim();
  const energyType = String(body.energyType || "").trim();
  const supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds.map(String) : [];

  if (!customerContactId || !isEnergyType(energyType)) {
    throw new Error("customerContactId and energyType are required");
  }

  const contactRow = await prisma.contact.findUnique({
    where: { id: customerContactId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      company: true,
      customerId: true,
    },
  });
  if (!contactRow) {
    throw new Error("Customer contact not found");
  }

  if (!customerId && contactRow.customerId) {
    customerId = contactRow.customerId;
  }

  let customer: Customer;
  if (!customerId) {
    customer = previewCustomerFromContact(contactRow);
  } else {
    if (contactRow.customerId && contactRow.customerId !== customerId) {
      throw new Error("Selected customer contact does not belong to the resolved customer record.");
    }
    const dbCustomer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!dbCustomer) {
      throw new Error("Customer not found");
    }
    customer = dbCustomer;
  }

  const customerContact = {
    id: contactRow.id,
    name: contactRow.name,
    email: contactRow.email,
    phone: contactRow.phone,
    customerId: contactRow.customerId,
  };

  if (supplierIds.length === 0) {
    throw new Error("Select at least one supplier");
  }

  const accountLines = normalizeAccountLines(body.accountLines);
  if (accountLines.length === 0) {
    throw new Error("Add at least one utility account");
  }

  const usageSummaryUrl = nonEmptyString(body.summarySpreadsheetUrl);
  const billDriveItems = normalizeRfpBillDriveItemsFromBody(body);
  const summaryDriveFileId = nonEmptyString(body.summaryDriveFileId);
  const usageSummaryAttachmentName = nonEmptyString(body.summaryAttachmentName);
  if (accountLines.length > 1) {
    const everyLineComplete = accountLines.every((line) => {
      const accountNumber = String(line.accountNumber ?? "").trim();
      const annualUsage = Number(line.annualUsage);
      const avgMonthlyUsage = Number(line.avgMonthlyUsage);
      return accountNumber && Number.isFinite(annualUsage) && Number.isFinite(avgMonthlyUsage);
    });
    if (!everyLineComplete) {
      throw new Error(
        "Multiple accounts: enter account number, annual usage, and average monthly usage on every account line."
      );
    }
  }

  const termValues = normalizeRequestedTerms(body.requestedTerms, body.customTermMonths);
  if (termValues.length === 0) {
    throw new Error("Select at least one requested term");
  }

  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, name: true },
  });

  if (suppliers.length !== supplierIds.length) {
    throw new Error("One or more selected suppliers were not found");
  }

  const contactPool = await prisma.contact.findMany({
    where: {
      OR: [
        { supplierId: { in: supplierIds } },
        {
          AND: [
            { company: { not: null } },
            { NOT: { company: "" } },
            {
              OR: [
                { label: { contains: "supplier", mode: "insensitive" } },
                { label: { contains: "vendor", mode: "insensitive" } },
              ],
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      firstName: true,
      email: true,
      phone: true,
      company: true,
      supplierId: true,
      label: true,
      isPriority: true,
      emails: { orderBy: { order: "asc" }, select: { email: true } },
    },
  });

  const deliverableContacts = flattenDeliverableSupplierContacts(suppliers, contactPool);

  const recipientTargets = recipientSlotsFromBody(body);
  let supplierRecipients: typeof deliverableContacts;
  if (recipientTargets.length > 0) {
    const hasExplicitEmail = recipientTargets.some((t) => (t.email || "").trim() !== "");
    if (hasExplicitEmail) {
      const want = new Set(
        recipientTargets.map((t) => `${t.contactId}\0${(t.email || "").trim().toLowerCase()}`)
      );
      supplierRecipients = deliverableContacts.filter((r) =>
        want.has(`${r.contactId}\0${r.email.trim().toLowerCase()}`)
      );
    } else {
      const ids = new Set(recipientTargets.map((t) => t.contactId));
      supplierRecipients = deliverableContacts.filter((r) => ids.has(r.contactId));
    }
  } else {
    supplierRecipients = deliverableContacts;
  }
  supplierRecipients = supplierRecipients.filter(
    (contact, index, all) =>
      all.findIndex((item) => item.email.toLowerCase() === contact.email.toLowerCase()) === index
  );

  if (supplierRecipients.length === 0) {
    throw new Error("Select at least one supplier contact with a deliverable email address");
  }

  const totals = accountLines.reduce(
    (acc, line) => {
      acc.annualUsage += line.annualUsage;
      acc.avgMonthlyUsage += line.avgMonthlyUsage;
      return acc;
    },
    { annualUsage: 0, avgMonthlyUsage: 0 }
  );

  const brokerMargin = parseOptionalNumber(body.brokerMargin);
  const brokerMarginUnit = isPriceUnit(body.brokerMarginUnit) ? body.brokerMarginUnit : null;
  const contractStartMonth = parseOptionalInteger(body.contractStartMonth);
  const contractStartYear = parseOptionalInteger(body.contractStartYear);
  const quoteDueDate = nonEmptyString(body.quoteDueDate);
  const billDocumentUrl = billDriveItems[0]?.webViewLink ?? nonEmptyString(body.googleDriveFolderUrl);
  const billAttachmentName = nonEmptyString(body.billAttachmentName);
  const ldcUtility = nonEmptyString(body.ldcUtility);
  const notes = nonEmptyString(body.notes);

  if (billDriveItems.length === 0 && !billAttachmentName) {
    throw new Error("A bill PDF link or local file is required");
  }
  if (!ldcUtility) {
    throw new Error("Select a utility / local distribution center");
  }
  if (!quoteDueDate) {
    throw new Error("Select a supplier quote due date");
  }
  if (!contractStartMonth || !contractStartYear) {
    throw new Error("Select a contract start month and year");
  }
  if (brokerMargin === null || brokerMarginUnit === null) {
    throw new Error("Enter a broker margin and unit");
  }

  const electricPricing =
    energyType === "ELECTRIC" ? normalizeElectricPricingFromBody(body, energyType) : null;
  if (
    electricPricing &&
    electricPricing.selectedIds.includes("fixed_rate_capacity_adjust") &&
    !electricPricing.fixedRateCapacityAdjustNote.trim()
  ) {
    throw new Error(
      'When "Fixed rate capacity adjust" is selected, enter the note for that pricing option.'
    );
  }

  const baseSubject = `${customer.name} | ${formatEnergyType(energyType)} | Quote`;
  const subjectPrefix = nonEmptyString(body.rfpSubjectPrefix);
  const subject = subjectPrefix ? `${subjectPrefix} — ${baseSubject}` : baseSubject;
  const enrollmentJson = enrollmentDetailsFromBody(body);
  const brokerForEmail =
    normalizeBrokerEmailSignature(brokerProfileFromBody(body)) ??
    brokerSignatureFromEnrollmentJson(enrollmentJson);
  const emailContent = buildRfpEmailBody({
    customer,
    customerContact,
    energyType,
    requestedTerms: termValues,
    quoteDueDate,
    contractStartMonth,
    contractStartYear,
    billDriveItems,
    usageSummaryUrl,
    billAttachmentName,
    usageSummaryAttachmentName,
    ldcUtility,
    brokerMargin,
    brokerMarginUnit,
    accountLines,
    notes: notes || undefined,
    brokerProfile: brokerForEmail,
    electricPricing,
  });

  return {
    customer,
    customerContact,
    energyType: energyType as EnergyType,
    suppliers,
    supplierRecipients,
    termValues,
    accountLines,
    totals,
    brokerMargin,
    brokerMarginUnit,
    attachments,
    billDriveItems,
    summaryDriveFileId,
    billAttachmentName,
    usageSummaryAttachmentName,
    contractStartMonth,
    contractStartYear,
    quoteDueDate,
    billDocumentUrl,
    usageSummaryUrl,
    ldcUtility,
    notes,
    subject,
    emailText: emailContent.text,
    emailHtml: emailContent.html,
    electricPricing,
  };
}

export async function sendMimeEmail(
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  opts: { to: string[]; subject: string; text: string; html?: string; attachments?: Attachment[] }
) {
  const raw = createMimeMessage({
    to: opts.to,
    cc: [],
    bcc: [],
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });

  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}

/**
 * Grants each RFP recipient **view-only** access to the specific Drive **files** linked in this send
 * (bill PDFs with `fileId` and optional summary spreadsheet). Uses `role: "reader"` only — no edit,
 * commenter, or writer roles. Does not share parent folders or anything beyond those file IDs.
 */
async function ensureDriveFilesAccessible(
  payload: {
    billDriveItems?: RfpBillDriveItem[];
    summaryDriveFileId?: string | null;
  },
  recipientEmails: string[]
) {
  const billIds = (payload.billDriveItems ?? [])
    .map((i) => i.fileId)
    .filter((id): id is string => Boolean(id && String(id).trim()));
  const fileIds = [...billIds, payload.summaryDriveFileId].filter(Boolean) as string[];
  const uniqueFileIds = [...new Set(fileIds)];
  const emails = Array.from(
    new Set(
      recipientEmails
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (uniqueFileIds.length === 0 || emails.length === 0) return;

  const drive = await getGoogleDriveClient();
  for (const fileId of uniqueFileIds) {
    for (const email of emails) {
      try {
        await drive.permissions.create({
          fileId,
          /**
           * Must be true when the address has no Google account: Drive requires an invite email
           * (same as "Notify people" in the share UI). `false` causes 400 for those recipients.
           * Gmail RFP delivery is separate; this only affects Drive's permission invite.
           */
          sendNotificationEmail: true,
          requestBody: {
            type: "user",
            /** Drive API: `reader` = view-only (cannot edit the file). */
            role: "reader",
            emailAddress: email,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("already") || message.includes("duplicate")) continue;
        throw new Error(`Failed to grant Google Drive access for ${email}. ${message}`.trim());
      }
    }
  }
}

export function personalizeEmailHtml(html: string, greetingName: string, supplierName: string) {
  return html.replace(
    /\{\{supplierContactName\}\}/g,
    escapeHtml(greetingName || supplierName || "there")
  );
}

function rfpSupplierGreeting(recipient: {
  greetingName: string;
  contactName: string;
  supplierName: string;
}): string {
  const g = (recipient.greetingName || "").trim();
  if (g) return g;
  const first = (recipient.contactName || "").trim().split(/\s+/)[0];
  if (first) return first;
  const s = (recipient.supplierName || "").trim();
  return s || "there";
}

/** Preview and test RFP emails use the first selected supplier contact, same as first live recipient. */
function personalizeForFirstSupplierRecipient(payload: {
  emailHtml: string;
  emailText: string;
  supplierRecipients: Array<{
    supplierName: string;
    contactName: string;
    greetingName: string;
  }>;
}): { html: string; text: string } {
  const first = payload.supplierRecipients[0];
  const greet = first ? rfpSupplierGreeting(first) : "there";
  return {
    html: personalizeEmailHtml(payload.emailHtml, greet, first?.supplierName ?? ""),
    text: payload.emailText.replace(/\{\{supplierContactName\}\}/g, greet),
  };
}

function escapeHeaderValue(value: string) {
  return value.replace(/[\\"]/g, "\\$&");
}

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isPriceUnit(value: unknown): value is PriceUnit {
  return typeof value === "string" && value in PriceUnit;
}

function isEnergyType(value: string): value is EnergyType {
  return value === "ELECTRIC" || value === "NATURAL_GAS";
}

function formatEnergyType(value: string) {
  return value === "NATURAL_GAS" ? "Natural Gas" : "Electric";
}

function normalizeSendMode(value: unknown): SendMode {
  return value === "preview" || value === "test" ? value : "send";
}

function normalizeRequestedTerms(requestedTerms: unknown, customTermMonths: unknown) {
  const normalized: Array<{ kind: "months"; months: number } | { kind: "nymex" }> = [];
  const seen = new Set<string>();

  if (Array.isArray(requestedTerms)) {
    for (const entry of requestedTerms) {
      if (entry === "NYMEX") {
        if (!seen.has("NYMEX")) {
          normalized.push({ kind: "nymex" });
          seen.add("NYMEX");
        }
        continue;
      }
      const months = Number.parseInt(String(entry), 10);
      if (Number.isFinite(months) && months > 0) {
        const key = `M:${months}`;
        if (!seen.has(key)) {
          normalized.push({ kind: "months", months });
          seen.add(key);
        }
      }
    }
  }

  const customMonths = Number.parseInt(String(customTermMonths ?? ""), 10);
  if (Number.isFinite(customMonths) && customMonths > 0) {
    const key = `M:${customMonths}`;
    if (!seen.has(key)) {
      normalized.push({ kind: "months", months: customMonths });
    }
  }

  return normalized.sort((a, b) => {
    if (a.kind === "nymex") return 1;
    if (b.kind === "nymex") return -1;
    return a.months - b.months;
  });
}

function normalizeAccountLines(accountLines: unknown) {
  if (!Array.isArray(accountLines)) return [];

  return accountLines
    .map((line) => {
      const accountNumber = String((line as Record<string, unknown>)?.accountNumber ?? "").trim();
      const annualUsage = Number((line as Record<string, unknown>)?.annualUsage);
      const avgMonthlyUsage = Number((line as Record<string, unknown>)?.avgMonthlyUsage);
      const serviceAddress = nonEmptyString((line as Record<string, unknown>)?.serviceAddress);

      if (!accountNumber || !Number.isFinite(annualUsage) || !Number.isFinite(avgMonthlyUsage)) {
        return null;
      }

      return {
        accountNumber,
        annualUsage,
        avgMonthlyUsage,
        serviceAddress,
      };
    })
    .filter((line): line is { accountNumber: string; annualUsage: number; avgMonthlyUsage: number; serviceAddress: string | null } => Boolean(line));
}

function formatRequestedTerm(term: { kind: "months"; months: number } | { kind: "nymex" }) {
  return term.kind === "nymex" ? "NYMEX" : `${term.months} months`;
}

function formatContractStart(month?: number, year?: number) {
  if (!month || !year) return "";
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatDisplayDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US");
}

function formatUsage(value: number) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Map DB `requestedTerms` JSON back to `/send` body fields. */
function dbRequestedTermsToForm(rt: unknown): { requestedTerms: string[]; customTermMonths: string } {
  const parts: string[] = [];
  const customs: number[] = [];
  if (Array.isArray(rt)) {
    for (const e of rt) {
      const o = e as { kind?: string; months?: number };
      if (o?.kind === "nymex") parts.push("NYMEX");
      else if (o?.kind === "months" && typeof o.months === "number") {
        const m = o.months;
        if (m === 12 || m === 24 || m === 36) parts.push(String(m));
        else customs.push(m);
      }
    }
  }
  if (parts.length === 0) parts.push("12", "24", "36");
  customs.sort((a, b) => a - b);
  return {
    requestedTerms: parts,
    customTermMonths: customs.join(", "),
  };
}

/**
 * Resend the same supplier RFP email (Drive links in body) with subject prefix "RFP Refresh".
 * Does not create a new `RfpRequest` row; increments `refreshSequence`.
 */
export async function resendStoredRfpSupplierEmails(
  rfpId: string
): Promise<{ sentTo: number; emailRecipientCount: number }> {
  const row = await prisma.rfpRequest.findUnique({
    where: { id: rfpId },
    include: {
      suppliers: { select: { id: true, name: true } },
      accountLines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!row) throw new Error("RFP not found");
  if (row.status === "draft" || !row.sentAt) {
    throw new Error("Only submitted RFPs can be refreshed to suppliers");
  }
  if (!row.customerContactId) throw new Error("RFP has no customer contact");

  const supplierContactSelections =
    row.supplierContactSelections &&
    typeof row.supplierContactSelections === "object" &&
    !Array.isArray(row.supplierContactSelections)
      ? (row.supplierContactSelections as Record<string, unknown>)
      : {};
  const supplierIds = row.suppliers.map((s) => s.id);
  const { requestedTerms: rtParts, customTermMonths } = dbRequestedTermsToForm(row.requestedTerms);
  const quoteDue = row.quoteDueDate ? row.quoteDueDate.toISOString().slice(0, 10) : "";

  const body: Record<string, unknown> = {
    customerId: row.customerId ?? "",
    customerContactId: row.customerContactId,
    energyType: row.energyType,
    supplierIds,
    supplierContactSelections,
    accountLines: row.accountLines.map((al) => ({
      accountNumber: al.accountNumber,
      serviceAddress: al.serviceAddress ?? "",
      annualUsage: Number(al.annualUsage),
      avgMonthlyUsage: Number(al.avgMonthlyUsage),
    })),
    requestedTerms: rtParts,
    customTermMonths,
    quoteDueDate: quoteDue,
    contractStartMonth: row.contractStartMonth ?? undefined,
    contractStartYear: row.contractStartYear ?? undefined,
    googleDriveFolderUrl: row.googleDriveFolderUrl ?? "",
    billDriveItems: row.billDriveItems ?? undefined,
    summarySpreadsheetUrl: row.summarySpreadsheetUrl ?? "",
    ldcUtility: row.ldcUtility ?? "",
    brokerMargin: row.brokerMargin != null ? String(row.brokerMargin) : "",
    brokerMarginUnit: row.brokerMarginUnit ?? "MCF",
    notes: row.notes ?? "",
    enrollmentDetails: row.enrollmentDetails ?? undefined,
    electricPricingOptions: row.electricPricingOptions ?? undefined,
    rfpSubjectPrefix: "RFP Refresh",
  };

  const payload = await buildRfpPayload(body, []);
  const gmail = await getGmailClient();
  await ensureDriveFilesAccessible(
    payload,
    payload.supplierRecipients.map((r) => r.email)
  );
  for (const recipient of payload.supplierRecipients) {
    const greet = rfpSupplierGreeting(recipient);
    await sendMimeEmail(gmail, {
      to: [recipient.email],
      subject: payload.subject,
      text: payload.emailText.replace(/\{\{supplierContactName\}\}/g, greet),
      html: personalizeEmailHtml(payload.emailHtml, greet, recipient.supplierName),
      attachments: payload.attachments,
    });
  }
  await prisma.rfpRequest.update({
    where: { id: rfpId },
    data: { refreshSequence: { increment: 1 } },
  });
  const emailRecipientCount = uniqueRecipientEmailCount(payload.supplierRecipients);
  return { sentTo: emailRecipientCount, emailRecipientCount };
}
