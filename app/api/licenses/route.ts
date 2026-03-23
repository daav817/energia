import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateLicenseExpiration } from "@/lib/license";
import { LicenseType } from "@/generated/prisma/client";

/**
 * POST /api/licenses
 * Create a new license. Expiration is auto-calculated as issueDate + 2 years.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { licenseType, licenseNumber, state, issueDate, notes } = body;

    if (!licenseType || !licenseNumber || !issueDate) {
      return NextResponse.json(
        { error: "licenseType, licenseNumber, and issueDate are required" },
        { status: 400 }
      );
    }

    const issue = new Date(issueDate);
    const expiration = calculateLicenseExpiration(issue);

    const license = await prisma.license.create({
      data: {
        licenseType: licenseType as LicenseType,
        licenseNumber,
        state: state ?? null,
        issueDate: issue,
        expirationDate: expiration,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(license);
  } catch (error) {
    console.error("License creation error:", error);
    return NextResponse.json(
      { error: "Failed to create license" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/licenses
 * List all licenses.
 */
export async function GET() {
  try {
    const licenses = await prisma.license.findMany({
      orderBy: { expirationDate: "asc" },
    });
    return NextResponse.json(licenses);
  } catch (error) {
    console.error("License fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch licenses" },
      { status: 500 }
    );
  }
}
