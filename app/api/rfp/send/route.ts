import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getGmailClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { EnergyType, PriceUnit } from "@/generated/prisma/client";

/**
 * POST /api/rfp/send
 * Send an RFP email to selected suppliers
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      customerId,
      customerContactId,
      energyType,
      supplierIds,
      requestedTerms,
      customTermMonths,
      quoteDueDate,
      contractStartMonth,
      contractStartYear,
      googleDriveFolderUrl,
      summarySpreadsheetUrl,
      ldcUtility,
      brokerMargin,
      brokerMarginUnit,
      accountLines,
      notes,
    } = body;

    if (!customerId || !customerContactId || !energyType) {
      return NextResponse.json(
        { error: "customerId, customerContactId, and energyType are required" },
        { status: 400 }
      );
    }
    if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
      return NextResponse.json({ error: "Select at least one supplier" }, { status: 400 });
    }

    const normalizedAccountLines = normalizeAccountLines(accountLines);
    if (normalizedAccountLines.length === 0) {
      return NextResponse.json({ error: "Add at least one utility account" }, { status: 400 });
    }
    if (normalizedAccountLines.length > 1 && !String(summarySpreadsheetUrl || "").trim()) {
      return NextResponse.json(
        { error: "A summary spreadsheet link is required when multiple accounts are included" },
        { status: 400 }
      );
    }

    const termValues = normalizeRequestedTerms(requestedTerms, customTermMonths);
    if (termValues.length === 0) {
      return NextResponse.json({ error: "Select at least one requested term" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        contacts: {
          where: { id: customerContactId },
          select: { id: true, name: true, email: true, phone: true },
          take: 1,
        },
      },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customerContact = customer.contacts[0];
    if (!customerContact) {
      return NextResponse.json(
        { error: "Customer contact not found. Add contact information before sending the RFP." },
        { status: 404 }
      );
    }

    const suppliers = await prisma.supplier.findMany({
      where: {
        id: { in: supplierIds.map(String) },
        ...(energyType === "ELECTRIC" ? { isElectric: true } : { isNaturalGas: true }),
      },
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
    });
    if (suppliers.length !== supplierIds.length) {
      return NextResponse.json(
        { error: "One or more selected suppliers do not match the requested energy type" },
        { status: 400 }
      );
    }

    const supplierRecipients = suppliers.flatMap((s) => {
      const primary = s.contacts[0];
      const email = primary?.email || s.email;
      return email
        ? [{ supplierId: s.id, supplierName: s.name, email }]
        : [];
    });
    const recipientEmails = supplierRecipients.map((r) => r.email);

    if (recipientEmails.length === 0) {
      return NextResponse.json(
        { error: "Selected suppliers do not have deliverable email addresses" },
        { status: 400 }
      );
    }

    const totals = normalizedAccountLines.reduce(
      (acc, line) => {
        acc.annualUsage += line.annualUsage;
        acc.avgMonthlyUsage += line.avgMonthlyUsage;
        return acc;
      },
      { annualUsage: 0, avgMonthlyUsage: 0 }
    );

    const marginValue = parseOptionalNumber(brokerMargin);
    const primaryTermMonths =
      termValues.find((value) => value.kind === "months")?.months ?? null;
    const quoteDue = quoteDueDate ? new Date(quoteDueDate) : null;

    const rfpRequest = await prisma.rfpRequest.create({
      data: {
        customerId,
        customerContactId,
        energyType: energyType as EnergyType,
        annualUsage: new Prisma.Decimal(totals.annualUsage),
        avgMonthlyUsage: new Prisma.Decimal(totals.avgMonthlyUsage),
        termMonths: primaryTermMonths,
        googleDriveFolderUrl: nonEmptyString(googleDriveFolderUrl),
        summarySpreadsheetUrl: nonEmptyString(summarySpreadsheetUrl),
        quoteDueDate: quoteDue,
        contractStartMonth: parseOptionalInteger(contractStartMonth),
        contractStartYear: parseOptionalInteger(contractStartYear),
        brokerMargin: marginValue === null ? null : new Prisma.Decimal(marginValue),
        brokerMarginUnit: isPriceUnit(brokerMarginUnit) ? brokerMarginUnit : null,
        ldcUtility: nonEmptyString(ldcUtility),
        requestedTerms: termValues,
        notes: notes || null,
        status: "sent",
        sentAt: new Date(),
        suppliers: { connect: suppliers.map((s) => ({ id: s.id })) },
        accountLines: {
          create: normalizedAccountLines.map((line, index) => ({
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
          title: `RFP quote deadline - ${customer.name}`,
          description: [
            `Energy type: ${formatEnergyType(energyType)}`,
            ldcUtility ? `Utility: ${ldcUtility}` : "",
            `Suppliers: ${suppliers.map((supplier) => supplier.name).join(", ")}`,
            googleDriveFolderUrl ? `Bills folder: ${googleDriveFolderUrl}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          startAt: quoteDue,
          allDay: true,
          eventType: "RFP_DEADLINE",
          customerId,
          contactId: customerContactId,
          rfpRequestId: rfpRequest.id,
        },
      });
    }

    const subject = `RFP: ${formatEnergyType(energyType)} - ${customer.name}${customer.company ? ` (${customer.company})` : ""}`;
    const emailBody = buildRfpEmailBody({
      customer,
      customerContact,
      energyType,
      requestedTerms: termValues,
      quoteDueDate: quoteDueDate,
      contractStartMonth,
      contractStartYear,
      googleDriveFolderUrl,
      summarySpreadsheetUrl,
      ldcUtility,
      brokerMargin: marginValue,
      brokerMarginUnit,
      accountLines: normalizedAccountLines,
      notes,
    });

    const gmail = await getGmailClient();
    const raw = createMimeMessage({
      to: recipientEmails,
      cc: [],
      bcc: [],
      subject,
      text: emailBody,
      html: undefined,
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

    return NextResponse.json({
      success: true,
      rfpRequestId: rfpRequest.id,
      sentTo: recipientEmails.length,
      suppliers: supplierRecipients.map((s) => s.supplierName),
    });
  } catch (err) {
    console.error("RFP send error:", err);
    const message = err instanceof Error ? err.message : "Failed to send RFP";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildRfpEmailBody(opts: {
  customer: { name: string; company: string | null };
  customerContact: { name: string; email: string | null; phone: string | null };
  energyType: string;
  requestedTerms: Array<{ kind: "months"; months: number } | { kind: "nymex" }>;
  quoteDueDate?: string;
  contractStartMonth?: number;
  contractStartYear?: number;
  googleDriveFolderUrl?: string;
  summarySpreadsheetUrl?: string;
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
}): string {
  const totalAnnual = opts.accountLines.reduce((sum, line) => sum + line.annualUsage, 0);
  const totalAvgMonthly = opts.accountLines.reduce((sum, line) => sum + line.avgMonthlyUsage, 0);
  const lines: string[] = [
    `Request for Pricing - ${formatEnergyType(opts.energyType)}`,
    "",
    `Customer: ${opts.customer.name}${opts.customer.company ? ` (${opts.customer.company})` : ""}`,
    `Broker Contact: ${opts.customerContact.name}`,
    opts.customerContact.email ? `Email: ${opts.customerContact.email}` : "",
    opts.customerContact.phone ? `Phone: ${opts.customerContact.phone}` : "",
    "",
    `Requested Terms: ${opts.requestedTerms.map(formatRequestedTerm).join(", ")}`,
    opts.contractStartMonth && opts.contractStartYear
      ? `Contract Start: ${String(opts.contractStartMonth).padStart(2, "0")}/${opts.contractStartYear}`
      : "",
    opts.quoteDueDate ? `Quote Due: ${opts.quoteDueDate}` : "",
    opts.ldcUtility ? `Local Distribution Company / Utility: ${opts.ldcUtility}` : "",
    opts.brokerMargin != null
      ? `Broker Margin: ${opts.brokerMargin.toFixed(6)} ${opts.brokerMarginUnit ? `$/ ${opts.brokerMarginUnit}` : ""}`.replace("$ /", "$/")
      : "",
    "",
    `Total Annual Usage: ${totalAnnual.toLocaleString()}`,
    `Average Monthly Usage: ${totalAvgMonthly.toLocaleString()}`,
    "",
    "Utility Accounts:",
    ...opts.accountLines.map((line, index) =>
      [
        `${index + 1}. Account ${line.accountNumber}`,
        line.serviceAddress ? `   Address: ${line.serviceAddress}` : "",
        `   Annual Usage: ${line.annualUsage.toLocaleString()}`,
        `   Avg Monthly Usage: ${line.avgMonthlyUsage.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    "",
    opts.googleDriveFolderUrl ? `Bills / backup documents: ${opts.googleDriveFolderUrl}` : "",
    opts.summarySpreadsheetUrl ? `Summary spreadsheet: ${opts.summarySpreadsheetUrl}` : "",
    "",
    opts.notes || "",
    "",
    "Please reply with your best quoted rate for each requested term.",
    "",
    "Thank you,",
    "Energia Power LLC",
  ];
  return lines.filter(Boolean).join("\n");
}

function createMimeMessage(opts: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}`;
  const lines: string[] = [
    `To: ${opts.to.join(", ")}`,
    opts.cc.length ? `Cc: ${opts.cc.join(", ")}` : "",
    opts.bcc.length ? `Bcc: ${opts.bcc.join(", ")}` : "",
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.text, "utf-8").toString("base64"),
  ];
  lines.push(`--${boundary}--`);
  return lines.filter(Boolean).join("\r\n");
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

function formatEnergyType(value: string) {
  return value === "NATURAL_GAS" ? "Natural Gas" : "Electric";
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
