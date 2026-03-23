import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Distinct label tokens (split on comma/semicolon) for Contacts filter dropdown. */
export async function GET() {
  try {
    const rows = await prisma.contact.findMany({ select: { label: true } });
    const set = new Set<string>();
    for (const r of rows) {
      const raw = (r.label || "").trim();
      if (!raw) continue;
      for (const part of raw.split(/[,;]+/g)) {
        const t = part.trim();
        if (t) set.add(t);
      }
    }
    const labels = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return NextResponse.json({ labels });
  } catch (error) {
    console.error("label-options error:", error);
    return NextResponse.json({ error: "Failed to load labels" }, { status: 500 });
  }
}
