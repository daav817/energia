import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  stripEnergySuffix,
  normalizeCompanyKey,
  isCustomerCandidateContact,
} from "@/lib/customers-overview";

type Member = {
  id: string;
  customerId: string | null;
  isPriority: boolean;
  name: string;
  email: string | null;
  phone: string | null;
  label: string | null;
  company: string | null;
  updatedAt: Date;
};

function pickPrimaryContactId(members: Member[], aggregatedCustomerId: string | null): string | null {
  if (members.length === 0) return null;
  const sorted = [...members].sort((a, b) => {
    const matchA = aggregatedCustomerId && a.customerId === aggregatedCustomerId ? 1 : 0;
    const matchB = aggregatedCustomerId && b.customerId === aggregatedCustomerId ? 1 : 0;
    if (matchA !== matchB) return matchB - matchA;
    if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  return sorted[0].id;
}

/**
 * Unique company names from Contacts that qualify as customer-side (label rules),
 * with optional linked Customer id and a suggested primary main contact for contracts.
 */
export async function GET() {
  try {
    const contacts = await prisma.contact.findMany({
      where: {
        company: { not: null },
        NOT: { company: "" },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        customerId: true,
        label: true,
        isPriority: true,
        updatedAt: true,
      },
    });

    const map = new Map<
      string,
      {
        displayName: string;
        customerId: string | null;
        memberIds: Set<string>;
        members: Member[];
      }
    >();

    for (const c of contacts) {
      const raw = c.company?.trim();
      if (!raw) continue;
      if (!isCustomerCandidateContact(c.label)) continue;

      const displayName = stripEnergySuffix(raw);
      const key = normalizeCompanyKey(displayName);
      if (!key) continue;

      let agg = map.get(key);
      if (!agg) {
        agg = {
          displayName,
          customerId: c.customerId,
          memberIds: new Set(),
          members: [],
        };
        map.set(key, agg);
      }

      if (!agg.memberIds.has(c.id)) {
        agg.memberIds.add(c.id);
        agg.members.push({
          id: c.id,
          customerId: c.customerId,
          isPriority: c.isPriority,
          name: c.name,
          email: c.email,
          phone: c.phone,
          label: c.label,
          company: c.company,
          updatedAt: c.updatedAt,
        });
      }

      if (!agg.customerId && c.customerId) {
        agg.customerId = c.customerId;
      }
    }

    const companies = Array.from(map.entries())
      .map(([companyKey, agg]) => ({
        id: companyKey,
        displayName: agg.displayName,
        customerId: agg.customerId,
        primaryContactId: pickPrimaryContactId(agg.members, agg.customerId),
        contacts: agg.members
          .slice()
          .sort((a, b) => {
            if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          })
          .map((member) => ({
            id: member.id,
            customerId: member.customerId,
            name: member.name,
            email: member.email,
            phone: member.phone,
            label: member.label,
            company: member.company,
          })),
      }))
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
      );

    return NextResponse.json({ companies });
  } catch (error) {
    console.error("customer-companies error:", error);
    return NextResponse.json({ error: "Failed to load companies" }, { status: 500 });
  }
}
