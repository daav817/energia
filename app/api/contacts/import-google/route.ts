import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client, loadTokens } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

function labelsToLabelString(labels: string[]): string | null {
  const filtered = labels
    .map((l) => (l ?? "").trim())
    .filter(Boolean)
    .filter((l) => {
      const t = l.toLowerCase();
      return t !== "mycontacts" && t !== "starred";
    });
  const cleaned = Array.from(new Set(filtered));
  return cleaned.length ? cleaned.join(", ") : null;
}

function extractSystemLabelToken(rnOrLabel: string): string {
  const last = (rnOrLabel || "").split("/").pop() || rnOrLabel || "";
  return String(last).trim();
}

function mapGoogleEmailType(t?: string | null): string {
  const u = (t || "").toLowerCase();
  if (u.includes("home")) return "home";
  if (u.includes("work")) return "work";
  if (u.includes("other")) return "other";
  return "work";
}

function mapGooglePhoneType(t?: string | null): string {
  const u = (t || "").toLowerCase();
  if (u.includes("mobile") || u.includes("cell")) return "mobile";
  if (u.includes("home")) return "home";
  if (u.includes("work")) return "work";
  if (u.includes("fax")) return "fax";
  return "work";
}

function mapGoogleAddressType(t?: string | null): string {
  const u = (t || "").toLowerCase();
  if (u.includes("home")) return "home";
  if (u.includes("work")) return "work";
  return "other";
}

function collectGroupResourceNames(personData: any): string[] {
  const groupResourceNames: string[] = [];
  const memberships = personData?.memberships;

  if (Array.isArray(memberships)) {
    for (const m of memberships) {
      const rn =
        m?.contactGroupMembership?.contactGroupResourceName ||
        m?.contactGroupMembership?.contactGroup?.resourceName;
      if (rn) groupResourceNames.push(String(rn));
    }
  } else if (memberships && typeof memberships === "object") {
    const maybeArray = (memberships as any).contactGroupMemberships;
    if (Array.isArray(maybeArray)) {
      for (const m of maybeArray) {
        const rn = m?.contactGroupResourceName || m?.contactGroup?.resourceName;
        if (rn) groupResourceNames.push(String(rn));
      }
    }
    const maybeSingle = (memberships as any).contactGroupMembership;
    const rn = maybeSingle?.contactGroupResourceName || maybeSingle?.contactGroup?.resourceName;
    if (rn) groupResourceNames.push(String(rn));
  }
  return groupResourceNames;
}

/**
 * Skip import if user has a Google group named "non-business".
 * Label string = all custom group display names (excluding myContacts / starred tokens).
 */
function labelStarredAndNonBusiness(
  personData: any,
  contactGroupDisplayNameByResourceName: Map<string, string>
): { skipNonBusiness: boolean; label: string | null; isStarred: boolean } {
  const groupResourceNames = collectGroupResourceNames(personData);
  let isStarred = false;
  const labelDisplayNames: string[] = [];

  for (const rn of groupResourceNames) {
    const token = extractSystemLabelToken(rn).toLowerCase();
    if (token === "starred") {
      isStarred = true;
      continue;
    }
    if (token === "mycontacts") continue;

    const display =
      contactGroupDisplayNameByResourceName.get(rn) || extractSystemLabelToken(rn) || rn;
    const dTrim = display.trim();
    if (dTrim.toLowerCase() === "non-business") {
      return { skipNonBusiness: true, label: null, isStarred: false };
    }
    labelDisplayNames.push(dTrim);
  }

  return {
    skipNonBusiness: false,
    label: labelsToLabelString(labelDisplayNames),
    isStarred,
  };
}

function parseGoogleNotes(person: any): string | null {
  const bios = person?.biographies;
  if (!Array.isArray(bios) || bios.length === 0) return null;
  const parts = bios.map((b: any) => (b?.value || b?.content || "").trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts.join("\n\n");
}

function parseEmails(person: any): Array<{ email: string; type: string; order: number }> {
  const list = person?.emailAddresses;
  if (!Array.isArray(list)) return [];
  return list
    .map((e: any, i: number) => ({
      email: String(e?.value || "").trim(),
      type: mapGoogleEmailType(e?.type),
      order: i,
    }))
    .filter((e) => e.email);
}

function parsePhones(person: any): Array<{ phone: string; type: string; order: number }> {
  const list = person?.phoneNumbers;
  if (!Array.isArray(list)) return [];
  return list
    .map((e: any, i: number) => ({
      phone: String(e?.value || "").trim(),
      type: mapGooglePhoneType(e?.type),
      order: i,
    }))
    .filter((e) => e.phone);
}

function parseAddresses(person: any): Array<{
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  type: string;
  order: number;
}> {
  const list = person?.addresses;
  if (!Array.isArray(list)) return [];
  return list
    .map((a: any, i: number) => {
      const street =
        (a?.streetAddress || "").trim() ||
        (a?.formattedValue || "")
          .split("\n")
          .map((s: string) => s.trim())
          .filter(Boolean)[0] ||
        null;
      return {
        street,
        city: (a?.city || "").trim() || null,
        state: (a?.region || a?.administrativeArea || "").trim() || null,
        zip: (a?.postalCode || "").trim() || null,
        type: mapGoogleAddressType(a?.type),
        order: i,
      };
    })
    .filter((a) => a.street || a.city || a.state || a.zip);
}

/**
 * POST /api/contacts/import-google
 * Import Google contacts: full emails, phones, addresses, labels, notes (biographies).
 * Skips contacts that belong to a Google group labeled "non-business" (case-insensitive).
 */
export async function POST() {
  try {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      return NextResponse.json(
        { error: "Gmail not connected. Complete OAuth flow first." },
        { status: 401 }
      );
    }

    const oauth2 = getOAuth2Client();
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
    });

    const people = google.people({ version: "v1", auth: oauth2 });

    const contactGroupDisplayNameByResourceName = new Map<string, string>();
    {
      let pageToken: string | undefined;
      do {
        const res = await people.contactGroups.list({
          pageSize: 200,
          pageToken,
          groupFields: "name",
        });
        const contactGroups = res.data.contactGroups || [];
        for (const g of contactGroups) {
          if (!g.resourceName || !g.name) continue;
          contactGroupDisplayNameByResourceName.set(String(g.resourceName), String(g.name));
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    const connections: any[] = [];
    {
      let pageToken: string | undefined;
      do {
        const res = await people.people.connections.list({
          resourceName: "people/me",
          pageSize: 500,
          pageToken,
          personFields:
            "names,emailAddresses,phoneNumbers,organizations,memberships,addresses,biographies",
        });
        connections.push(...(res.data.connections || []));
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    let imported = 0;
    let skippedExisting = 0;
    let skippedNonBusiness = 0;
    let skippedNoIdentity = 0;

    for (const p of connections) {
      const { skipNonBusiness, label, isStarred } = labelStarredAndNonBusiness(
        p,
        contactGroupDisplayNameByResourceName
      );
      if (skipNonBusiness) {
        skippedNonBusiness++;
        continue;
      }

      const nameObj = p.names?.[0];
      const name =
        nameObj?.displayName ||
        [nameObj?.givenName, nameObj?.middleName, nameObj?.familyName].filter(Boolean).join(" ").trim() ||
        "Unknown";
      const firstName = nameObj?.givenName?.trim() || null;
      const lastName = nameObj?.familyName?.trim() || null;

      const emails = parseEmails(p);
      const phones = parsePhones(p);
      const addresses = parseAddresses(p);
      const notes = parseGoogleNotes(p);

      const company = p.organizations?.[0]?.name?.trim() || null;
      const jobTitle = p.organizations?.[0]?.title?.trim() || null;
      const resourceName = p.resourceName;

      const primaryEmail = emails[0]?.email || null;
      const primaryPhone = phones[0]?.phone || null;

      if (!emails.length && !phones.length && (!name || name === "Unknown")) {
        skippedNoIdentity++;
        continue;
      }

      const emailCreates = emails.map((e, i) => ({ email: e.email, type: e.type, order: i }));
      const phoneCreates = phones.map((e, i) => ({ phone: e.phone, type: e.type, order: i }));
      const addressCreates = addresses.map((a, i) => ({
        street: a.street,
        city: a.city,
        state: a.state,
        zip: a.zip,
        type: a.type,
        order: i,
      }));

      const existing = await prisma.contact.findFirst({
        where: { googleResourceName: resourceName ?? undefined },
      });

      if (existing) {
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            name,
            firstName,
            lastName,
            email: primaryEmail,
            phone: primaryPhone,
            company,
            jobTitle,
            label,
            isPriority: isStarred,
            notes,
            emails: { deleteMany: {}, create: emailCreates },
            phones: { deleteMany: {}, create: phoneCreates },
            addresses: { deleteMany: {}, create: addressCreates },
          },
        });
        skippedExisting++;
        continue;
      }

      await prisma.contact.create({
        data: {
          name,
          firstName,
          lastName,
          email: primaryEmail,
          phone: primaryPhone,
          company,
          jobTitle,
          label,
          isPriority: isStarred,
          notes,
          source: "google",
          googleResourceName: resourceName || null,
          emails: emailCreates.length ? { create: emailCreates } : undefined,
          phones: phoneCreates.length ? { create: phoneCreates } : undefined,
          addresses: addressCreates.length ? { create: addressCreates } : undefined,
        },
      });
      imported++;
    }

    return NextResponse.json({
      imported,
      skipped: skippedExisting,
      skippedNonBusiness,
      skippedNoIdentity,
    });
  } catch (err) {
    console.error("Google contacts import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import Google contacts" },
      { status: 500 }
    );
  }
}
