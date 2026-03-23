import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { EnergyType } from "@/generated/prisma/client";

/**
 * POST /api/rfp/send
 * Send RFP email to all suppliers matching the energy type
 * Body: { customerId, energyType, annualUsage?, avgMonthlyUsage?, termMonths?, billUrl?, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      customerId,
      energyType,
      annualUsage,
      avgMonthlyUsage,
      termMonths,
      billUrl,
      notes,
    } = body;

    if (!customerId || !energyType) {
      return NextResponse.json(
        { error: "customerId and energyType are required" },
        { status: 400 }
      );
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const supplierFilter =
      energyType === "ELECTRIC"
        ? { isElectric: true }
        : energyType === "NATURAL_GAS"
          ? { isNaturalGas: true }
          : { OR: [{ isElectric: true }, { isNaturalGas: true }] };

    const suppliers = await prisma.supplier.findMany({
      where: supplierFilter,
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
    });

    const recipientEmails = suppliers.flatMap((s) => {
      const primary = s.contacts[0];
      if (primary?.email) return [primary.email];
      return s.email ? [s.email] : [];
    });

    if (recipientEmails.length === 0) {
      return NextResponse.json(
        { error: "No suppliers found for this energy type" },
        { status: 400 }
      );
    }

    const rfpRequest = await prisma.rfpRequest.create({
      data: {
        customerId,
        energyType: energyType as EnergyType,
        annualUsage: annualUsage ? parseFloat(annualUsage) : null,
        avgMonthlyUsage: avgMonthlyUsage ? parseFloat(avgMonthlyUsage) : null,
        termMonths: termMonths ? parseInt(termMonths, 10) : null,
        billDocumentId: billUrl || null,
        notes: notes || null,
        status: "sent",
        sentAt: new Date(),
        suppliers: { connect: suppliers.map((s) => ({ id: s.id })) },
      },
    });

    const subject = `RFP: ${energyType} - ${customer.name}${customer.company ? ` (${customer.company})` : ""}`;
    const emailBody = buildRfpEmailBody({
      customer,
      energyType,
      annualUsage,
      avgMonthlyUsage,
      termMonths,
      billUrl,
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
      suppliers: suppliers.map((s) => s.name),
    });
  } catch (err) {
    console.error("RFP send error:", err);
    const message = err instanceof Error ? err.message : "Failed to send RFP";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildRfpEmailBody(opts: {
  customer: { name: string; company: string | null; email: string | null };
  energyType: string;
  annualUsage?: number;
  avgMonthlyUsage?: number;
  termMonths?: number;
  billUrl?: string;
  notes?: string;
}): string {
  const lines: string[] = [
    `Request for Pricing - ${opts.energyType}`,
    "",
    `Customer: ${opts.customer.name}${opts.customer.company ? ` (${opts.customer.company})` : ""}`,
    opts.customer.email ? `Contact: ${opts.customer.email}` : "",
    "",
    opts.annualUsage ? `Annual Usage: ${opts.annualUsage.toLocaleString()}` : "",
    opts.avgMonthlyUsage
      ? `Average Monthly Usage: ${opts.avgMonthlyUsage.toLocaleString()}`
      : "",
    opts.termMonths ? `Requested Term: ${opts.termMonths} months` : "",
    "",
    opts.billUrl ? `Bill/Document: ${opts.billUrl}` : "",
    "",
    opts.notes || "",
    "",
    "Please respond with your best pricing.",
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
