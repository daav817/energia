import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client, loadTokens } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

type SyncChoices = {
  incoming: string[]; // resourceNames to import
  outgoing: string[]; // local contact ids to push
  conflicts: Record<string, "local" | "google" | "skip">; // localId -> choice
};

function normalizeLabelTokens(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

/**
 * POST /api/contacts/sync
 * Execute sync with user choices for conflicts
 * Body: { incoming: string[], outgoing: string[], conflicts: { [localId]: "local"|"google"|"skip" } }
 */
export async function POST(request: NextRequest) {
  try {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      return NextResponse.json(
        { error: "Gmail not connected. Complete OAuth flow first." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as SyncChoices;
    const { incoming = [], outgoing = [], conflicts = {} } = body;

    const oauth2 = getOAuth2Client();
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
    });

    const people = google.people({ version: "v1", auth: oauth2 });
    let imported = 0;
    let pushed = 0;

    // Load all Google contact groups once so we can map labels <-> group resource names.
    const contactGroupDisplayNameByResourceName = new Map<string, string>();
    const contactGroupResourceNameByDisplayName = new Map<string, string>();
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
          const rn = String(g.resourceName);
          const dn = String(g.name);
          contactGroupDisplayNameByResourceName.set(rn, dn);
          contactGroupResourceNameByDisplayName.set(dn.toLowerCase(), rn);
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    const extractLabelFromPerson = async (
      personData: any
    ): Promise<{ label: string | null; isStarred: boolean }> => {
      const memberships = personData?.memberships;
      const groupResourceNames: string[] = [];
      let isStarred = false;

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

      const labels: string[] = [];
      for (const rn of groupResourceNames) {
        const token = extractSystemLabelToken(rn).toLowerCase();
        if (token === "starred") {
          isStarred = true;
          continue;
        }
        if (token === "mycontacts") continue;

        const known = contactGroupDisplayNameByResourceName.get(rn);
        labels.push(known || extractSystemLabelToken(rn));
      }

      return { label: labelsToLabelString(labels), isStarred };
    };

    const updateGoogleMemberships = async (
      googleResourceName: string,
      desiredLabelString: string | null,
      desiredIsStarred: boolean
    ) => {
      const desiredLabels = normalizeLabelTokens(desiredLabelString);

      const membershipFromLabelTokenOrCreate = async (
        labelToken: string
      ): Promise<string | null> => {
        const token = labelToken.toLowerCase();

        const direct = contactGroupResourceNameByDisplayName.get(token);
        if (direct) return direct;

        // Fuzzy match to handle cases like "customer" vs "Customers"
        for (const [displayLower, rn] of contactGroupResourceNameByDisplayName.entries()) {
          if (displayLower.includes(token) || token.includes(displayLower)) return rn;
        }

        // If not found, attempt to create a new Google contact group so the label can sync.
        try {
          const created = await people.contactGroups.create({
            requestBody: {
              contactGroup: { name: labelToken },
            },
            readGroupFields: "name",
          } as any);

          const newRn = created?.data?.resourceName || null;
          if (!newRn) return null;

          contactGroupDisplayNameByResourceName.set(newRn, String(labelToken));
          contactGroupResourceNameByDisplayName.set(token, newRn);
          return newRn;
        } catch (err) {
          // Duplicate names and permission issues should not break sync; just skip the new label mapping.
          console.error("Failed to create contact group for label:", labelToken, err);
          return null;
        }
      };

      const customMembershipResourceNames: string[] = [];
      for (const t of desiredLabels) {
        const lt = t.toLowerCase();
        if (lt === "mycontacts" || lt === "starred") continue;
        const rn = await membershipFromLabelTokenOrCreate(t);
        if (rn) customMembershipResourceNames.push(rn);
      }

      // We need the etag for updateContact, and also existing memberships so we can preserve system groups.
      const personForUpdate = await people.people.get({
        resourceName: googleResourceName,
        personFields: "metadata,memberships",
      });
      const etag = personForUpdate.data?.metadata?.sources?.[0]?.etag;
      if (!etag) return;

      const existingMembershipRNs: string[] = Array.isArray(personForUpdate.data?.memberships)
        ? personForUpdate.data.memberships
            .map(
              (m: any) =>
                m?.contactGroupMembership?.contactGroupResourceName ||
                m?.contactGroupMembership?.contactGroup?.resourceName
            )
            .filter(Boolean)
        : [];

      const existingMyContactsRNs = existingMembershipRNs.filter(
        (rn) => extractSystemLabelToken(rn).toLowerCase() === "mycontacts"
      );
      const existingStarredRN = existingMembershipRNs.find(
        (rn) => extractSystemLabelToken(rn).toLowerCase() === "starred"
      );

      const preserved = existingMyContactsRNs.length ? existingMyContactsRNs : ["contactGroups/myContacts"];
      const desiredStarredRN =
        desiredIsStarred ? existingStarredRN ?? "contactGroups/starred" : null;

      const finalMembershipResourceNames = Array.from(
        new Set([...(preserved ?? []), ...customMembershipResourceNames, ...(desiredStarredRN ? [desiredStarredRN] : [])])
      );

      // Ensure People API constraint: contact must always have at least one membership.
      const safeMembershipResourceNames = finalMembershipResourceNames.length
        ? finalMembershipResourceNames
        : ["contactGroups/myContacts"];

      try {
        await people.people.updateContact({
          resourceName: googleResourceName,
          updatePersonFields: "memberships",
          requestBody: {
            resourceName: googleResourceName,
            etag,
            memberships: safeMembershipResourceNames.map((rn) => ({
              contactGroupMembership: { contactGroupResourceName: rn },
            })),
          },
        });
      } catch (err) {
        console.error("Google membership update failed:", err);
      }
    };

    // Import selected from Google
    for (const resourceName of incoming) {
      try {
        const person = await people.people.get({
          resourceName,
          personFields: "names,emailAddresses,phoneNumbers,organizations,memberships",
        });
        const p = person.data;
        const name = p.names?.[0]?.displayName || p.names?.[0]?.givenName || "Unknown";
        const email = p.emailAddresses?.[0]?.value;
        const phone = p.phoneNumbers?.[0]?.value;
        const company = p.organizations?.[0]?.name;
        const { label, isStarred } = await extractLabelFromPerson(p);

        const existing = await prisma.contact.findFirst({
          where: { googleResourceName: resourceName },
        });
        if (existing) {
          if (existing.label !== label || existing.isPriority !== isStarred) {
            await prisma.contact.update({
              where: { id: existing.id },
              data: { label, isPriority: isStarred },
            });
          }
          continue;
        }

        await prisma.contact.create({
          data: {
            name,
            email: email || null,
            phone: phone || null,
            company: company || null,
            label,
            isPriority: isStarred,
            source: "google",
            googleResourceName: resourceName,
            emails: email ? { create: [{ email, type: "work", order: 0 }] } : undefined,
            phones: phone ? { create: [{ phone, type: "work", order: 0 }] } : undefined,
          },
        });
        imported++;
      } catch (e) {
        console.error("Import contact error:", e);
      }
    }

    // Handle conflicts
    for (const [localId, choice] of Object.entries(conflicts)) {
      if (choice === "skip") continue;
      const contact = await prisma.contact.findUnique({
        where: { id: localId },
        include: { emails: true, phones: true },
      });
      if (!contact?.googleResourceName) continue;

      try {
        if (choice === "google") {
          const person = await people.people.get({
            resourceName: contact.googleResourceName,
            personFields: "names,emailAddresses,phoneNumbers,organizations,memberships",
          });
          const p = person.data;
          const name = p.names?.[0]?.displayName || p.names?.[0]?.givenName || "Unknown";
          const email = p.emailAddresses?.[0]?.value;
          const phone = p.phoneNumbers?.[0]?.value;
          const company = p.organizations?.[0]?.name;
          const { label, isStarred } = await extractLabelFromPerson(p);

          await prisma.contact.update({
            where: { id: localId },
            data: {
              name,
              email: email || null,
              phone: phone || null,
              company: company || null,
              label,
              isPriority: isStarred,
              emails: { deleteMany: {}, create: email ? [{ email, type: "work", order: 0 }] : [] },
              phones: { deleteMany: {}, create: phone ? [{ phone, type: "work", order: 0 }] : [] },
            },
          });
        } else if (choice === "local") {
          const primaryEmail = contact.emails[0]?.email ?? contact.email;
          const primaryPhone = contact.phones[0]?.phone ?? contact.phone;
          await people.people.updateContact({
            resourceName: contact.googleResourceName,
            updatePersonFields: "names,emailAddresses,phoneNumbers,organizations",
            requestBody: {
              names: [{ displayName: contact.name }],
              emailAddresses: primaryEmail ? [{ value: primaryEmail }] : [],
              phoneNumbers: primaryPhone ? [{ value: primaryPhone }] : [],
              organizations: contact.company ? [{ name: contact.company }] : [],
            },
          });
          // Also push our label -> memberships when available.
          await updateGoogleMemberships(contact.googleResourceName, contact.label ?? null, !!contact.isPriority);
          pushed++;
        }
      } catch (e) {
        console.error("Conflict resolve error:", e);
      }
    }

    // Push selected local to Google
    for (const id of outgoing) {
      if (conflicts[id]) continue;
      const contact = await prisma.contact.findUnique({
        where: { id },
        include: { emails: true, phones: true },
      });
      if (!contact) continue;

      const primaryEmail = contact.emails[0]?.email ?? contact.email;
      const primaryPhone = contact.phones[0]?.phone ?? contact.phone;
      if (!primaryEmail && !contact.name) continue;

      try {
        if (contact.googleResourceName) {
          await people.people.updateContact({
            resourceName: contact.googleResourceName,
            updatePersonFields: "names,emailAddresses,phoneNumbers,organizations",
            requestBody: {
              names: [{ displayName: contact.name }],
              emailAddresses: primaryEmail ? [{ value: primaryEmail }] : [],
              phoneNumbers: primaryPhone ? [{ value: primaryPhone }] : [],
              organizations: contact.company ? [{ name: contact.company }] : [],
            },
          });
          await updateGoogleMemberships(contact.googleResourceName, contact.label ?? null, !!contact.isPriority);
        } else {
          const created = await people.people.createContact({
            requestBody: {
              names: [{ displayName: contact.name }],
              emailAddresses: primaryEmail ? [{ value: primaryEmail }] : [],
              phoneNumbers: primaryPhone ? [{ value: primaryPhone }] : [],
              organizations: contact.company ? [{ name: contact.company }] : [],
            },
          });
          if (created.data.resourceName) {
            await prisma.contact.update({
              where: { id },
              data: { googleResourceName: created.data.resourceName, source: "google" },
            });
            await updateGoogleMemberships(
              created.data.resourceName,
              contact.label ?? null,
              !!contact.isPriority
            );
          }
        }
        pushed++;
      } catch (e) {
        console.error("Push contact error:", e);
      }
    }

    return NextResponse.json({ imported, pushed });
  } catch (err) {
    console.error("Sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
