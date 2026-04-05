import { NextRequest, NextResponse } from "next/server";

type OhioUtility = "AEP" | "DUKE" | "FIRSTENERGY" | "COLUMBIA";

const ALLOWED = new Set<string>(["AEP", "DUKE", "FIRSTENERGY", "COLUMBIA"]);

/**
 * POST /api/utilities/meter-read-schedule
 * Body: { utility: OhioUtility, accountNumber?: string }
 *
 * Ohio utilities do not expose a consistent public REST API for meter-read calendars in this app.
 * This endpoint returns a deterministic placeholder schedule so the RFP UI can be exercised; replace
 * with vendor integrations or audited business rules before production use.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const utility = String(body.utility ?? "")
      .toUpperCase()
      .replace(/\s+/g, "") as OhioUtility;
    const normalizedUtility = utility.replace("ENERGY", "").replace("OHIO", "");
    const key =
      normalizedUtility === "AEP"
        ? "AEP"
        : normalizedUtility.includes("DUKE")
          ? "DUKE"
          : normalizedUtility.includes("FIRSTENERGY") || normalizedUtility.includes("EDISON")
            ? "FIRSTENERGY"
            : normalizedUtility.includes("COLUMBIA")
              ? "COLUMBIA"
              : utility;

    if (!ALLOWED.has(key)) {
      return NextResponse.json(
        { error: "utility must be one of: AEP, Duke, FirstEnergy, Columbia Gas" },
        { status: 400 }
      );
    }

    const acct = String(body.accountNumber ?? "0000000");
    let seed = 0;
    for (let i = 0; i < acct.length; i++) seed = (seed * 31 + acct.charCodeAt(i)) >>> 0;

    const today = new Date();
    const months: { monthKey: string; readDate: string; label: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const dayJitter = 3 + (seed % 12);
      d.setDate(Math.min(dayJitter + (i % 5), 28));
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      months.push({
        monthKey: `${y}-${String(m).padStart(2, "0")}`,
        readDate: `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      });
    }

    return NextResponse.json({
      utility: key,
      source: "stub",
      notice:
        "These dates are simulated for UI workflow only. Connect utility-specific data sources for production accuracy.",
      months,
    });
  } catch (e) {
    console.error("meter-read-schedule", e);
    return NextResponse.json({ error: "Failed to build schedule" }, { status: 500 });
  }
}
