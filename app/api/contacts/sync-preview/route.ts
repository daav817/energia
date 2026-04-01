import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client, loadTokens } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

type SyncPreview = {
  incomingFromGoogle: Array<{ name: string; email?: string; resourceName: string }>;
  outgoingToGoogle: Array<{ id: string; name: string; email?: string; change: "new" | "updated" }>;
  conflicts: Array<{
    localId: string;
    googleResourceName: string;
    name: string;
    localChanges: string;
    googleChanges: string;
    diffFields: Array<{
      key: string;
      label: string;
      localValue: string;
      googleValue: string;
    }>;
  }>;
};

function normalizeText(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

function normalizeAddress(parts: {
  street?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
}) {
  return [
    normalizeText(parts.street),
    normalizeText(parts.city),
    normalizeText(parts.state),
    normalizeText(parts.zip),
  ]
    .filter(Boolean)
    .join(" | ");
}

function displayValue(raw: unknown): string {
  const normalized = normalizeText(raw);
  return normalized ?? "(empty)";
}

function normalizeNameValue(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildFullName(firstName: unknown, lastName: unknown): string | null {
  const combined = [normalizeText(firstName), normalizeText(lastName)].filter(Boolean).join(" ");
  return combined || null;
}

function namesMatch(values: Array<unknown>): boolean {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeNameValue(value))
        .filter(Boolean)
    )
  );
  return normalized.length <= 1;
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
    const rn =
      maybeSingle?.contactGroupResourceName || maybeSingle?.contactGroup?.resourceName;
    if (rn) groupResourceNames.push(String(rn));
  }
  return groupResourceNames;
}

/**
 * GET /api/contacts/sync-preview
 * Preview what will happen on sync: incoming from Google, outgoing to Google, conflicts
 */
export async function GET() {
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

    // Load Google contact group display names to map memberships -> our `Contact.label`.
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
          // Store "displayName" in our internal map as the human-readable group label.
          contactGroupDisplayNameByResourceName.set(String(g.resourceName), String(g.name));
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    const normalizeLabelString = (raw: unknown) => {
      if (typeof raw !== "string") return "";
      const parts = raw
        .split(/[,;]+/g)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const filtered = parts.filter((p) => p !== "mycontacts" && p !== "starred");
      filtered.sort();
      return filtered.join(", ");
    };

    const normalizeEmail = (raw: unknown) => {
      const s = String(raw ?? "").trim().toLowerCase();
      return s || null;
    };
    const normalizePhone = (raw: unknown) => {
      const s = String(raw ?? "").trim();
      if (!s) return null;
      // Keep digits and an optional leading '+'
      const cleaned = s.replace(/[^\d+]/g, "");
      return cleaned || null;
    };
    const extractLabelStringFromPerson = (personData: any) => {
      const groupResourceNames = collectGroupResourceNames(personData);
      let isStarred = false;
      let skipNonBusiness = false;

      const labels = groupResourceNames.map(
        (rn) => {
          const token = String(rn.split("/").pop() || "").toLowerCase();
          if (token === "starred") {
            isStarred = true;
            return "";
          }
          if (token === "mycontacts") return "";
          const display = contactGroupDisplayNameByResourceName.get(rn) || (rn.split("/").pop() || rn);
          if (String(display).trim().toLowerCase() === "non-business") {
            skipNonBusiness = true;
            return "";
          }
          return display;
        }
      );

      const cleaned = Array.from(new Set(labels.map((l) => String(l).trim()).filter(Boolean)));
      return { label: cleaned.join(", "), isStarred, skipNonBusiness };
    };

    const googleConnections: any[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const res: { data: { connections?: any[]; nextPageToken?: string | null } } = await people.people.connections.list({
        resourceName: "people/me",
        pageSize: 500,
        pageToken,
        personFields: "names,emailAddresses,phoneNumbers,organizations,memberships,addresses,biographies",
      });

      googleConnections.push(...(res.data.connections || []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    const localContacts = await prisma.contact.findMany({
      include: {
        emails: true,
        phones: true,
        addresses: true,
      },
    });

    const preview: SyncPreview = {
      incomingFromGoogle: [],
      outgoingToGoogle: [],
      conflicts: [],
    };

    const googleByResource = new Map(
      googleConnections.map((p) => {
        const name = p.names?.[0]?.displayName || p.names?.[0]?.givenName || "Unknown";
        const emailList: string[] = (p.emailAddresses || [])
          .map((e: any) => e?.value)
          .filter(Boolean);
        const phoneList: string[] = (p.phoneNumbers || [])
          .map((ph: any) => ph?.value)
          .filter(Boolean);
        const email = emailList[0];
        const phone = phoneList[0];
        const firstName = normalizeText(p.names?.[0]?.givenName);
        const lastName = normalizeText(p.names?.[0]?.familyName);
        const company = p.organizations?.[0]?.name;
        const jobTitle = p.organizations?.[0]?.title;
        const notes = Array.isArray(p.biographies)
          ? p.biographies
              .map((b: any) => normalizeText(b?.value || b?.content))
              .filter(Boolean)
              .join("\n\n")
          : null;
        const address = Array.isArray(p.addresses)
          ? normalizeAddress({
              street: p.addresses[0]?.streetAddress,
              city: p.addresses[0]?.city,
              state: p.addresses[0]?.region || p.addresses[0]?.administrativeArea,
              zip: p.addresses[0]?.postalCode,
            })
          : "";
        const { label, isStarred, skipNonBusiness } = extractLabelStringFromPerson(p);
        return [
          p.resourceName!,
          {
            name,
            firstName,
            lastName,
            email,
            phone,
            emailList,
            phoneList,
            company,
            jobTitle,
            notes,
            address,
            label,
            isStarred,
            skipNonBusiness,
            resourceName: p.resourceName,
          },
        ];
      })
    );

    const localByGoogle = new Map(
      localContacts
        .filter((c) => c.googleResourceName)
        .map((c) => [c.googleResourceName!, c])
    );

    // Incoming: in Google, not in local (or not linked)
    for (const [, g] of googleByResource) {
      if (!g.resourceName) continue;
      if (g.skipNonBusiness) continue;
      const local = localByGoogle.get(g.resourceName);
      if (!local) {
        preview.incomingFromGoogle.push({
          name: g.name,
          email: g.email,
          resourceName: g.resourceName,
        });
      }
    }

    // Outgoing and conflicts: local contacts that are new or updated vs Google
    for (const local of localContacts) {
      const primaryEmail = local.emails[0]?.email ?? local.email;
      const primaryPhone = local.phones[0]?.phone ?? local.phone;
      const primaryAddress = local.addresses[0];
      const localAddress = normalizeAddress({
        street: primaryAddress?.street,
        city: primaryAddress?.city,
        state: primaryAddress?.state,
        zip: primaryAddress?.zip,
      });

      if (local.googleResourceName) {
        const g = googleByResource.get(local.googleResourceName);
        if (g) {
          if (g.skipNonBusiness) continue;
          const localEmailNorm = normalizeEmail(primaryEmail);
          const googleEmailNorm = normalizeEmail(g.email);
          const localPhoneNorm = normalizePhone(primaryPhone);
          const googlePhoneNorm = normalizePhone(g.phone);

          const localChanged =
            !namesMatch([
              local.name,
              buildFullName(local.firstName, local.lastName),
              g.name,
              buildFullName(g.firstName, g.lastName),
            ]) ||
            localEmailNorm !== googleEmailNorm ||
            localPhoneNorm !== googlePhoneNorm ||
            normalizeText(local.company) !== normalizeText(g.company) ||
            normalizeText(local.jobTitle) !== normalizeText(g.jobTitle) ||
            normalizeText(local.notes) !== normalizeText(g.notes) ||
            localAddress !== g.address ||
            normalizeLabelString(local.label) !== normalizeLabelString(g.label) ||
            (local.isPriority ?? false) !== (g.isStarred ?? false);
          if (localChanged) {
            const diffFields = [
              {
                key: "name",
                label: "Name",
                localValue: displayValue(buildFullName(local.firstName, local.lastName) || local.name),
                googleValue: displayValue(buildFullName(g.firstName, g.lastName) || g.name),
              },
              {
                key: "email",
                label: "Email",
                localValue: displayValue(primaryEmail),
                googleValue: displayValue(g.email),
              },
              {
                key: "phone",
                label: "Phone",
                localValue: displayValue(primaryPhone),
                googleValue: displayValue(g.phone),
              },
              {
                key: "company",
                label: "Company",
                localValue: displayValue(local.company),
                googleValue: displayValue(g.company),
              },
              {
                key: "jobTitle",
                label: "Job Title",
                localValue: displayValue(local.jobTitle),
                googleValue: displayValue(g.jobTitle),
              },
              {
                key: "address",
                label: "Address",
                localValue: displayValue(localAddress),
                googleValue: displayValue(g.address),
              },
              {
                key: "labels",
                label: "Labels",
                localValue: displayValue(local.label),
                googleValue: displayValue(g.label),
              },
              {
                key: "notes",
                label: "Notes",
                localValue: displayValue(local.notes),
                googleValue: displayValue(g.notes),
              },
              {
                key: "starred",
                label: "Starred",
                localValue: (local.isPriority ?? false) ? "Yes" : "No",
                googleValue: g.isStarred ? "Yes" : "No",
              },
            ].filter((field) => field.localValue !== field.googleValue);

            preview.conflicts.push({
              localId: local.id,
              googleResourceName: local.googleResourceName,
              name: local.name,
              localChanges:
                `${local.name} | email=${primaryEmail || ""} | phone=${primaryPhone || ""} | ` +
                `company=${local.company || ""} | title=${local.jobTitle || ""} | ` +
                `address=${localAddress || ""} | labels=${local.label || ""} | ` +
                `notes=${local.notes || ""} | star=${local.isPriority ? "yes" : "no"}`,
              googleChanges:
                `${g.name} | email=${g.email || ""} | phone=${g.phone || ""} | ` +
                `company=${g.company || ""} | title=${g.jobTitle || ""} | ` +
                `address=${g.address || ""} | labels=${g.label || ""} | ` +
                `notes=${g.notes || ""} | star=${g.isStarred ? "yes" : "no"}`,
              diffFields,
            });
          }
        } else {
          // If a linked contact is missing from the Google snapshot,
          // don't show an outgoing suggestion (it can be caused by pagination/limits).
          // Sync will still resolve once Google data is complete/consistent.
        }
      } else if (local.source === "local") {
        preview.outgoingToGoogle.push({
          id: local.id,
          name: local.name,
          email: primaryEmail ?? undefined,
          change: "new",
        });
      }
    }

    return NextResponse.json(preview);
  } catch (err) {
    console.error("Sync preview error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get sync preview" },
      { status: 500 }
    );
  }
}
