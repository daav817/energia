import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSupplierCandidateContact } from "@/lib/customers-overview";
import { contactMatchesRfpEnergy } from "@/lib/supplier-rfp-contacts";

export async function GET() {
  try {
    const contacts = await prisma.contact.findMany({
      where: {
        label: {
          contains: "supplier",
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        name: true,
        company: true,
        label: true,
        email: true,
        phone: true,
      },
      orderBy: [{ company: "asc" }, { name: "asc" }],
    });

    const gaps = contacts.filter((contact) => {
      if (!isSupplierCandidateContact(contact.label)) return false;
      const hasElec = contactMatchesRfpEnergy(contact.label, "ELECTRIC");
      const hasGas = contactMatchesRfpEnergy(contact.label, "NATURAL_GAS");
      return !hasElec && !hasGas;
    });

    return NextResponse.json({
      total: gaps.length,
      contacts: gaps,
    });
  } catch (error) {
    console.error("Supplier label gaps fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch supplier label gaps" }, { status: 500 });
  }
}
