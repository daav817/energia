import { prisma } from "@/lib/prisma";
import { parseCustomerQuoteEmailDraft } from "@/lib/customer-quote-email-draft";

/** Extract likely email addresses from quote summary "To" / "Cc" text. */
function emailsFromQuoteDraftText(to: string, cc: string): string[] {
  const raw = `${to} ${cc}`;
  const found = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (!found?.length) return [];
  return [...new Set(found.map((e) => e.toLowerCase()))].slice(0, 24);
}

function emailOrConditions(emails: string[]) {
  return emails.flatMap((e) => [
    { email: { equals: e, mode: "insensitive" as const } },
    { emails: { some: { email: { equals: e, mode: "insensitive" as const } } } },
  ]);
}

/** Match CRM Customer by company display string (directory / contact company line). */
async function customerIdByCompanyLabel(label: string | null | undefined): Promise<string | null> {
  const q = label?.trim();
  if (!q) return null;
  const row = await prisma.customer.findFirst({
    where: {
      OR: [
        { company: { equals: q, mode: "insensitive" } },
        { name: { equals: q, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Resolves which CRM Customer (`Customer.id`) an RFP belongs to when `rfp.customerId` was never set.
 * Quotes/RFP UIs often link only contacts, To/Cc lines, or company labels — not the denormalized FK.
 */
export async function resolveCustomerIdForArchivedRfp(rfpId: string): Promise<string | null> {
  const row = await prisma.rfpRequest.findUnique({
    where: { id: rfpId },
    select: {
      customerId: true,
      customerContactId: true,
      quoteSummaryContactIds: true,
      customerQuoteEmailDraft: true,
    },
  });
  if (!row) return null;
  if (row.customerId) return row.customerId;

  const wf = await prisma.contractWorkflowRow.findUnique({
    where: { linkedRfpRequestId: rfpId },
    select: { customerId: true },
  });
  if (wf?.customerId) return wf.customerId;

  if (row.customerContactId) {
    const c = await prisma.contact.findUnique({
      where: { id: row.customerContactId },
      select: { customerId: true, company: true, name: true },
    });
    if (c?.customerId) return c.customerId;
    const byCompany = await customerIdByCompanyLabel(c?.company);
    if (byCompany) return byCompany;
  }

  if (row.quoteSummaryContactIds.length > 0) {
    const withCust = await prisma.contact.findFirst({
      where: { id: { in: row.quoteSummaryContactIds }, customerId: { not: null } },
      select: { customerId: true },
    });
    if (withCust?.customerId) return withCust.customerId;

    const anyCo = await prisma.contact.findFirst({
      where: { id: { in: row.quoteSummaryContactIds } },
      select: { company: true },
    });
    const byCo = await customerIdByCompanyLabel(anyCo?.company);
    if (byCo) return byCo;
  }

  const draft = parseCustomerQuoteEmailDraft(row.customerQuoteEmailDraft);
  const emails = emailsFromQuoteDraftText(draft?.to ?? "", draft?.cc ?? "");

  if (emails.length > 0) {
    for (const em of emails) {
      const custDirect = await prisma.customer.findFirst({
        where: { email: { equals: em, mode: "insensitive" } },
        select: { id: true },
      });
      if (custDirect) return custDirect.id;
    }

    const contactStrict = await prisma.contact.findFirst({
      where: {
        customerId: { not: null },
        OR: emailOrConditions(emails),
      },
      select: { customerId: true },
    });
    if (contactStrict?.customerId) return contactStrict.customerId;

    const contactLoose = await prisma.contact.findFirst({
      where: { OR: emailOrConditions(emails) },
      select: { customerId: true, company: true },
    });
    if (contactLoose?.customerId) return contactLoose.customerId;
    const byLooseCo = await customerIdByCompanyLabel(contactLoose?.company);
    if (byLooseCo) return byLooseCo;

    const custViaContacts = await prisma.customer.findFirst({
      where: {
        contacts: {
          some: { OR: emailOrConditions(emails) },
        },
      },
      select: { id: true },
    });
    if (custViaContacts) return custViaContacts.id;
  }

  return null;
}
