import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function parseLabelTokens(raw: string | null | undefined) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/g)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

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
      const labels = parseLabelTokens(contact.label);
      return labels.includes("supplier") && !labels.includes("gas") && !labels.includes("electric");
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
