import { NextRequest, NextResponse } from "next/server";
import { Prisma, CalendarEventType, EnergyType, PriceUnit } from "@/generated/prisma/client";
import { getGmailClient, getGoogleDriveClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { flattenDeliverableSupplierContacts } from "@/lib/supplier-rfp-contacts";

type SendMode = "preview" | "test" | "send";
type Attachment = { filename: string; content: Buffer; mimeType: string };

export async function POST(request: NextRequest) {
  try {
    const { body, attachments } = await parseRequestPayload(request);
    const mode = normalizeSendMode(body.mode);
    const payload = await buildRfpPayload(body, attachments);

    if (mode === "preview") {
      return NextResponse.json({
        success: true,
        subject: payload.subject,
        text: payload.emailText,
        html: payload.emailHtml,
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

      await sendMimeEmail(gmail, {
        to: [testEmail],
        subject: `[TEST] ${payload.subject}`,
        text: payload.emailText,
        html: payload.emailHtml,
        attachments: payload.attachments,
      });

      return NextResponse.json({ success: true, sentTo: 1, testEmail });
    }

    const quoteDue = payload.quoteDueDate ? new Date(payload.quoteDueDate) : null;
    const primaryTermMonths =
      payload.termValues.find((value) => value.kind === "months")?.months ?? null;

    const rfpRequest = await prisma.rfpRequest.create({
      data: {
        customerId: payload.customer.id,
        customerContactId: payload.customerContact.id,
        energyType: payload.energyType,
        annualUsage: new Prisma.Decimal(payload.totals.annualUsage),
        avgMonthlyUsage: new Prisma.Decimal(payload.totals.avgMonthlyUsage),
        termMonths: primaryTermMonths,
        googleDriveFolderUrl: payload.billDocumentUrl,
        summarySpreadsheetUrl: payload.usageSummaryUrl,
        quoteDueDate: quoteDue,
        contractStartMonth: payload.contractStartMonth,
        contractStartYear: payload.contractStartYear,
        brokerMargin:
          payload.brokerMargin === null ? null : new Prisma.Decimal(payload.brokerMargin),
        brokerMarginUnit: payload.brokerMarginUnit,
        ldcUtility: payload.ldcUtility,
        requestedTerms: payload.termValues,
        notes: payload.notes,
        status: "sent",
        sentAt: new Date(),
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
            payload.billDocumentUrl ? `Bills folder: ${payload.billDocumentUrl}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          startAt: quoteDue,
          allDay: true,
          eventType: CalendarEventType.SUPPLIER_QUOTE_DUE_RFP,
          customerId: payload.customer.id,
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
      await sendMimeEmail(gmail, {
        to: [recipient.email],
        subject: payload.subject,
        text: payload.emailText,
        html: personalizeEmailHtml(payload.emailHtml, recipient.contactName, recipient.supplierName),
        attachments: payload.attachments,
      });
    }

    return NextResponse.json({
      success: true,
      rfpRequestId: rfpRequest.id,
      sentTo: payload.supplierRecipients.length,
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

function buildRfpEmailBody(opts: {
  customer: { name: string; company: string | null };
  customerContact: { name: string; email: string | null; phone: string | null };
  energyType: string;
  requestedTerms: Array<{ kind: "months"; months: number } | { kind: "nymex" }>;
  quoteDueDate?: string;
  contractStartMonth?: number;
  contractStartYear?: number;
  billDocumentUrl?: string | null;
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

  const marginText =
    opts.brokerMargin != null
      ? `${opts.brokerMargin.toFixed(6)} ${opts.brokerMarginUnit ? `$/` + opts.brokerMarginUnit : ""}`
      : "To be provided with quoted price";
  const billReference = opts.billDocumentUrl
    ? `<a href="${escapeHtml(opts.billDocumentUrl)}">Open bill link</a>`
    : opts.billAttachmentName
      ? `Attached file: ${escapeHtml(opts.billAttachmentName)}`
      : "—";
  const usageReference = [
    opts.usageSummaryUrl ? `<a href="${escapeHtml(opts.usageSummaryUrl)}">Open usage summary</a>` : "",
    opts.usageSummaryAttachmentName ? `Attached file: ${escapeHtml(opts.usageSummaryAttachmentName)}` : "",
    usageSummaryLines.join("<br /><br />"),
  ]
    .filter(Boolean)
    .join("<br /><br />");

  const rows = [
    ["Energy Type", formatEnergyType(opts.energyType)],
    ["Local Distribution Center", opts.ldcUtility || "—"],
    ["Customer Name", `${opts.customer.name}${opts.customer.company ? ` (${opts.customer.company})` : ""}`],
    ["Contract Length Requested", opts.requestedTerms.map(formatRequestedTerm).join(", ")],
    ["Contract Starting Month/Year", contractStart || "—"],
    ["Broker Margin", `${marginText} (please include this into the quoted price)`],
    ["Customer’s Energy Type Bills for pricing", billReference],
    ["Usage Summary", usageReference],
  ];

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #111; line-height: 1.4;">
      <p style="font-size: 28px; margin: 0 0 8px;"><strong>${escapeHtml(opts.customer.name)}</strong> | <strong>${escapeHtml(formatEnergyType(opts.energyType))}</strong> Quote</p>
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
      ${opts.notes ? `<p style="margin-top: 18px;">${escapeHtml(opts.notes)}</p>` : ""}
      <p style="margin-top: 18px;">If you have any questions about this request, please contact me.</p>
      <p>Thank you!</p>
      <p style="margin-top: 22px;">
        Tamara Gregory<br />
        Energia Power LLC<br />
        234-207-2994<br />
        234-414-6763 (fax)<br />
        <a href="mailto:tamara@energiapower.llc">tamara@energiapower.llc</a>
      </p>
    </div>
  `.trim();

  const textLines = [
    `${opts.customer.name} | ${formatEnergyType(opts.energyType)} Quote`,
    `Date Submitted: ${formatDisplayDate(new Date().toISOString())}`,
    "",
    "Hi {{supplierContactName}},",
    "",
    `Please provide a quote for this customer on the following date: ${formatDisplayDate(opts.quoteDueDate || "")}.`,
    "",
    "Pricing Terms and Customer Information:",
    `Energy Type: ${formatEnergyType(opts.energyType)}`,
    `Local Distribution Center: ${opts.ldcUtility || "—"}`,
    `Customer Name: ${opts.customer.name}${opts.customer.company ? ` (${opts.customer.company})` : ""}`,
    `Contract Length Requested: ${opts.requestedTerms.map(formatRequestedTerm).join(", ")}`,
    `Contract Starting Month/Year: ${contractStart || "—"}`,
    `Broker Margin: ${marginText}`,
    `Customer Bills: ${opts.billDocumentUrl || (opts.billAttachmentName ? `Attached file: ${opts.billAttachmentName}` : "—")}`,
    `Usage Summary Link: ${opts.usageSummaryUrl || (opts.usageSummaryAttachmentName ? `Attached file: ${opts.usageSummaryAttachmentName}` : "—")}`,
    usageSummaryText,
    "",
    opts.notes || "",
    "If you have any questions about this request, please contact me.",
    "",
    "Thank you!",
    "",
    "Tamara Gregory",
    "Energia Power LLC",
    "234-207-2994",
    "234-414-6763 (fax)",
    "tamara@energiapower.llc",
  ];

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

async function buildRfpPayload(body: Record<string, unknown>, attachments: Attachment[] = []) {
  let customerId = String(body.customerId || "").trim();
  const customerContactId = String(body.customerContactId || "").trim();
  const energyType = String(body.energyType || "").trim();
  const supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds.map(String) : [];
  const supplierContactIds = Array.isArray(body.supplierContactIds)
    ? body.supplierContactIds.map(String)
    : [];

  if (!customerContactId || !isEnergyType(energyType)) {
    throw new Error("customerContactId and energyType are required");
  }

  const contactRecord = await prisma.contact.findUnique({
    where: { id: customerContactId },
    select: { id: true, customerId: true },
  });
  if (!contactRecord) {
    throw new Error("Customer contact not found");
  }

  if (!customerId && contactRecord.customerId) {
    customerId = contactRecord.customerId;
  }
  if (!customerId) {
    throw new Error(
      "This contact is not linked to a customer record yet. Use “Add customer + contact” to create the company record and link, then try again."
    );
  }
  if (contactRecord.customerId && contactRecord.customerId !== customerId) {
    throw new Error("Selected customer contact does not belong to the resolved customer record.");
  }
  if (supplierIds.length === 0) {
    throw new Error("Select at least one supplier");
  }

  const accountLines = normalizeAccountLines(body.accountLines);
  if (accountLines.length === 0) {
    throw new Error("Add at least one utility account");
  }

  const usageSummaryUrl = nonEmptyString(body.summarySpreadsheetUrl);
  const billDriveFileId = nonEmptyString(body.billDriveFileId);
  const summaryDriveFileId = nonEmptyString(body.summaryDriveFileId);
  const usageSummaryAttachmentName = nonEmptyString(body.summaryAttachmentName);
  if (accountLines.length > 1 && !usageSummaryUrl && !usageSummaryAttachmentName) {
    throw new Error("A usage summary link or local file is required when multiple accounts are included");
  }

  const termValues = normalizeRequestedTerms(body.requestedTerms, body.customTermMonths);
  if (termValues.length === 0) {
    throw new Error("Select at least one requested term");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!customer) {
    throw new Error("Customer not found");
  }

  const customerContact = await prisma.contact.findFirst({
    where: {
      id: customerContactId,
      OR: [{ customerId }, { customerId: null }],
    },
    select: { id: true, name: true, email: true, phone: true, customerId: true },
  });
  if (!customerContact) {
    throw new Error("Customer contact not found. Add contact information before sending the RFP.");
  }

  const suppliers = await prisma.supplier.findMany({
    where: {
      id: { in: supplierIds },
      ...(energyType === "ELECTRIC" ? { isElectric: true } : { isNaturalGas: true }),
    },
    select: { id: true, name: true },
  });

  if (suppliers.length !== supplierIds.length) {
    throw new Error("One or more selected suppliers do not match the requested energy type");
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
      email: true,
      phone: true,
      company: true,
      supplierId: true,
      label: true,
      isPriority: true,
      emails: { orderBy: { order: "asc" }, take: 1, select: { email: true } },
    },
  });

  const deliverableContacts = flattenDeliverableSupplierContacts(suppliers, contactPool);

  const supplierRecipients = (supplierContactIds.length > 0
    ? deliverableContacts.filter((contact) => supplierContactIds.includes(contact.contactId))
    : deliverableContacts
  ).filter((contact, index, all) => all.findIndex((item) => item.email === contact.email) === index);

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
  const billDocumentUrl = nonEmptyString(body.googleDriveFolderUrl);
  const billAttachmentName = nonEmptyString(body.billAttachmentName);
  const ldcUtility = nonEmptyString(body.ldcUtility);
  const notes = nonEmptyString(body.notes);

  if (!billDocumentUrl && !billAttachmentName) {
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

  const subject = `${customer.name} | ${formatEnergyType(energyType)} | Quote`;
  const emailContent = buildRfpEmailBody({
    customer,
    customerContact,
    energyType,
    requestedTerms: termValues,
    quoteDueDate,
    contractStartMonth,
    contractStartYear,
    billDocumentUrl,
    usageSummaryUrl,
    billAttachmentName,
    usageSummaryAttachmentName,
    ldcUtility,
    brokerMargin,
    brokerMarginUnit,
    accountLines,
    notes: notes || undefined,
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
    billDriveFileId,
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
  };
}

async function sendMimeEmail(
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

async function ensureDriveFilesAccessible(
  payload: {
    billDriveFileId?: string | null;
    summaryDriveFileId?: string | null;
  },
  recipientEmails: string[]
) {
  const fileIds = [payload.billDriveFileId, payload.summaryDriveFileId].filter(Boolean) as string[];
  const emails = Array.from(
    new Set(
      recipientEmails
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (fileIds.length === 0 || emails.length === 0) return;

  const drive = await getGoogleDriveClient();
  for (const fileId of fileIds) {
    for (const email of emails) {
      try {
        await drive.permissions.create({
          fileId,
          sendNotificationEmail: false,
          requestBody: {
            type: "user",
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

function personalizeEmailHtml(html: string, supplierContactName: string, supplierName: string) {
  return html.replace(/\{\{supplierContactName\}\}/g, escapeHtml(supplierContactName || supplierName || "there"));
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
