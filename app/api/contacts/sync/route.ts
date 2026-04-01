import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client, loadTokens } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

type SyncChoices = {
  incoming: string[]; // resourceNames to import
  outgoing: string[]; // local contact ids to push
  conflicts: Record<string, Record<string, "local" | "google" | "skip">>; // localId -> fieldKey -> choice
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

function extractMembershipResourceNamesFromPerson(personData: any): string[] {
  return Array.isArray(personData?.memberships)
    ? personData.memberships
        .map(
          (m: any) =>
            m?.contactGroupMembership?.contactGroupResourceName ||
            m?.contactGroupMembership?.contactGroup?.resourceName
        )
        .filter(Boolean)
    : [];
}

function normalizeText(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value || null;
}

function buildLocalGooglePersonRequest(contact: {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  notes?: string | null;
  emails: Array<{ email: string }>;
  phones: Array<{ phone: string }>;
  addresses: Array<{
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  }>;
}) {
  const primaryEmail = contact.emails[0]?.email ?? null;
  const primaryPhone = contact.phones[0]?.phone ?? null;
  const primaryAddress = contact.addresses[0];

  return {
    names: [
      {
        displayName: contact.name,
        givenName: normalizeText(contact.firstName),
        familyName: normalizeText(contact.lastName),
      },
    ],
    emailAddresses: primaryEmail ? [{ value: primaryEmail }] : [],
    phoneNumbers: primaryPhone ? [{ value: primaryPhone }] : [],
    organizations:
      contact.company || contact.jobTitle
        ? [
            {
              name: normalizeText(contact.company),
              title: normalizeText(contact.jobTitle),
            },
          ]
        : [],
    addresses: primaryAddress
      ? [
          {
            streetAddress: normalizeText(primaryAddress.street),
            city: normalizeText(primaryAddress.city),
            region: normalizeText(primaryAddress.state),
            postalCode: normalizeText(primaryAddress.zip),
          },
        ]
      : [],
    biographies: contact.notes ? [{ value: contact.notes }] : [],
  };
}

function parseGoogleNotes(person: any): string | null {
  const bios = person?.biographies;
  if (!Array.isArray(bios) || bios.length === 0) return null;
  const parts = bios.map((b: any) => String(b?.value || b?.content || "").trim()).filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

function parseGoogleAddresses(person: any): Array<{
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  type: string;
  order: number;
}> {
  const list = Array.isArray(person?.addresses) ? person.addresses : [];
  return list
    .map((a: any, i: number) => ({
      street: String(a?.streetAddress || "").trim() || null,
      city: String(a?.city || "").trim() || null,
      state: String(a?.region || a?.administrativeArea || "").trim() || null,
      zip: String(a?.postalCode || "").trim() || null,
      type: "work",
      order: i,
    }))
    .filter(
      (a: { street: string | null; city: string | null; state: string | null; zip: string | null }) =>
        a.street || a.city || a.state || a.zip
    );
}

type ContactSnapshot = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  notes: string | null;
  label: string | null;
  isPriority: boolean;
  emails: Array<{ email: string }>;
  phones: Array<{ phone: string }>;
  addresses: Array<{ street?: string | null; city?: string | null; state?: string | null; zip?: string | null }>;
};

function localSnapshotFromContact(contact: any): ContactSnapshot {
  const emails =
    contact.emails.length > 0
      ? contact.emails.map((item: any) => ({ email: item.email }))
      : contact.email
        ? [{ email: contact.email }]
        : [];
  const phones =
    contact.phones.length > 0
      ? contact.phones.map((item: any) => ({ phone: item.phone }))
      : contact.phone
        ? [{ phone: contact.phone }]
        : [];

  return {
    name: contact.name,
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    email: contact.email ?? emails[0]?.email ?? null,
    phone: contact.phone ?? phones[0]?.phone ?? null,
    company: contact.company ?? null,
    jobTitle: contact.jobTitle ?? null,
    notes: contact.notes ?? null,
    label: contact.label ?? null,
    isPriority: !!contact.isPriority,
    emails,
    phones,
    addresses: contact.addresses.map((address: any) => ({
      street: address.street ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      zip: address.zip ?? null,
    })),
  };
}

function googleSnapshotFromPerson(person: any, extracted: { label: string | null; isStarred: boolean }): ContactSnapshot {
  const nameObj = person.names?.[0];
  const emails = Array.isArray(person.emailAddresses)
    ? person.emailAddresses
        .map((item: any) => ({ email: String(item?.value || "").trim() }))
        .filter((item: { email: string }) => item.email)
    : [];
  const phones = Array.isArray(person.phoneNumbers)
    ? person.phoneNumbers
        .map((item: any) => ({ phone: String(item?.value || "").trim() }))
        .filter((item: { phone: string }) => item.phone)
    : [];

  return {
    name: nameObj?.displayName || nameObj?.givenName || "Unknown",
    firstName: normalizeText(nameObj?.givenName),
    lastName: normalizeText(nameObj?.familyName),
    email: emails[0]?.email ?? null,
    phone: phones[0]?.phone ?? null,
    company: normalizeText(person.organizations?.[0]?.name),
    jobTitle: normalizeText(person.organizations?.[0]?.title),
    notes: parseGoogleNotes(person),
    label: extracted.label,
    isPriority: extracted.isStarred,
    emails,
    phones,
    addresses: parseGoogleAddresses(person),
  };
}

function applyFieldChoice(
  fieldKey: string,
  choice: "local" | "google" | "skip" | undefined,
  localSource: ContactSnapshot,
  googleSource: ContactSnapshot,
  nextLocal: ContactSnapshot,
  nextGoogle: ContactSnapshot
) {
  if (!choice || choice === "skip") return;

  const source = choice === "local" ? localSource : googleSource;

  switch (fieldKey) {
    case "name":
      nextLocal.name = source.name;
      nextLocal.firstName = source.firstName;
      nextLocal.lastName = source.lastName;
      nextGoogle.name = source.name;
      nextGoogle.firstName = source.firstName;
      nextGoogle.lastName = source.lastName;
      return;
    case "email":
      nextLocal.email = source.email;
      nextLocal.emails = source.email ? [{ email: source.email }] : [];
      nextGoogle.email = source.email;
      nextGoogle.emails = source.email ? [{ email: source.email }] : [];
      return;
    case "phone":
      nextLocal.phone = source.phone;
      nextLocal.phones = source.phone ? [{ phone: source.phone }] : [];
      nextGoogle.phone = source.phone;
      nextGoogle.phones = source.phone ? [{ phone: source.phone }] : [];
      return;
    case "company":
      nextLocal.company = source.company;
      nextGoogle.company = source.company;
      return;
    case "jobTitle":
      nextLocal.jobTitle = source.jobTitle;
      nextGoogle.jobTitle = source.jobTitle;
      return;
    case "address":
      nextLocal.addresses = source.addresses;
      nextGoogle.addresses = source.addresses;
      return;
    case "labels":
      nextLocal.label = source.label;
      nextGoogle.label = source.label;
      return;
    case "notes":
      nextLocal.notes = source.notes;
      nextGoogle.notes = source.notes;
      return;
    case "starred":
      nextLocal.isPriority = source.isPriority;
      nextGoogle.isPriority = source.isPriority;
      return;
    default:
      return;
  }
}

/**
 * POST /api/contacts/sync
 * Execute sync with user choices for conflicts
 * Body: { incoming: string[], outgoing: string[], conflicts: { [localId]: { [fieldKey]: "local"|"google"|"skip" } } }
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
    const failures: Array<{ id: string; name?: string; stage: string; message: string }> = [];

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

    const buildGoogleMemberships = async (
      desiredLabelString: string | null,
      desiredIsStarred: boolean,
      currentMembershipResourceNames?: string[]
    ): Promise<Array<{ contactGroupMembership: { contactGroupResourceName: string } }>> => {
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

      const existingMembershipRNs: string[] = currentMembershipResourceNames ?? [];

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

      return safeMembershipResourceNames.map((rn) => ({
        contactGroupMembership: { contactGroupResourceName: rn },
      }));
    };

    const updateGoogleContactFromLocal = async (contact: {
      googleResourceName: string;
      name: string;
      firstName?: string | null;
      lastName?: string | null;
      company?: string | null;
      jobTitle?: string | null;
      notes?: string | null;
      label?: string | null;
      isPriority?: boolean | null;
      emails: Array<{ email: string }>;
      phones: Array<{ phone: string }>;
      addresses: Array<{ street?: string | null; city?: string | null; state?: string | null; zip?: string | null }>;
      currentEtag?: string | null;
      currentMembershipResourceNames?: string[];
    }) => {
      const etag = contact.currentEtag ?? null;
      if (!etag) {
        throw new Error(`Missing etag for Google contact ${contact.googleResourceName}`);
      }

      await people.people.updateContact({
        resourceName: contact.googleResourceName,
        updatePersonFields:
          "names,emailAddresses,phoneNumbers,organizations,addresses,biographies,memberships",
        requestBody: {
          resourceName: contact.googleResourceName,
          etag,
          ...buildLocalGooglePersonRequest(contact),
          memberships: await buildGoogleMemberships(
            contact.label ?? null,
            !!contact.isPriority,
            contact.currentMembershipResourceNames
          ),
        },
      });
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
    for (const [localId, fieldChoices] of Object.entries(conflicts)) {
      const activeChoices = Object.values(fieldChoices || {}).filter((choice) => choice !== "skip");
      if (activeChoices.length === 0) continue;
      const contact = await prisma.contact.findUnique({
        where: { id: localId },
        include: { emails: true, phones: true, addresses: true },
      });
      if (!contact?.googleResourceName) continue;

      try {
        const person = await people.people.get({
          resourceName: contact.googleResourceName,
          personFields: "names,emailAddresses,phoneNumbers,organizations,memberships,addresses,biographies",
        });
        const personEtag = person.data?.etag || person.data?.metadata?.sources?.[0]?.etag || null;
        const membershipResourceNames = extractMembershipResourceNamesFromPerson(person.data);
        const googleExtracted = await extractLabelFromPerson(person.data);
        const localSource = localSnapshotFromContact(contact);
        const googleSource = googleSnapshotFromPerson(person.data, googleExtracted);
        const nextLocal: ContactSnapshot = {
          ...localSource,
          emails: [...localSource.emails],
          phones: [...localSource.phones],
          addresses: [...localSource.addresses],
        };
        const nextGoogle: ContactSnapshot = {
          ...googleSource,
          emails: [...googleSource.emails],
          phones: [...googleSource.phones],
          addresses: [...googleSource.addresses],
        };

        for (const [fieldKey, choice] of Object.entries(fieldChoices || {})) {
          applyFieldChoice(fieldKey, choice, localSource, googleSource, nextLocal, nextGoogle);
        }

        const localEmailCreates = nextLocal.emails.map((item, i) => ({ email: item.email, type: "work", order: i }));
        const localPhoneCreates = nextLocal.phones.map((item, i) => ({ phone: item.phone, type: "work", order: i }));
        const localAddressCreates = nextLocal.addresses.map((item, i) => ({
          street: item.street ?? null,
          city: item.city ?? null,
          state: item.state ?? null,
          zip: item.zip ?? null,
          type: "work",
          order: i,
        }));

        await prisma.contact.update({
          where: { id: localId },
          data: {
            name: nextLocal.name,
            firstName: nextLocal.firstName,
            lastName: nextLocal.lastName,
            email: nextLocal.email,
            phone: nextLocal.phone,
            company: nextLocal.company,
            jobTitle: nextLocal.jobTitle,
            label: nextLocal.label,
            notes: nextLocal.notes,
            isPriority: nextLocal.isPriority,
            emails: { deleteMany: {}, create: localEmailCreates },
            phones: { deleteMany: {}, create: localPhoneCreates },
            addresses: { deleteMany: {}, create: localAddressCreates },
          },
        });

        await updateGoogleContactFromLocal({
          googleResourceName: contact.googleResourceName,
          name: nextGoogle.name,
          firstName: nextGoogle.firstName,
          lastName: nextGoogle.lastName,
          company: nextGoogle.company,
          jobTitle: nextGoogle.jobTitle,
          notes: nextGoogle.notes,
          label: nextGoogle.label,
          isPriority: nextGoogle.isPriority,
          emails: nextGoogle.emails,
          phones: nextGoogle.phones,
          addresses: nextGoogle.addresses,
          currentEtag: personEtag,
          currentMembershipResourceNames: membershipResourceNames,
        });
        pushed++;
      } catch (e) {
        console.error("Conflict resolve error:", e);
        failures.push({
          id: localId,
          name: contact.name,
          stage: "conflict_resolve",
          message: e instanceof Error ? e.message : "Conflict resolve failed",
        });
      }
    }

    // Push selected local to Google
    for (const id of outgoing) {
      if (conflicts[id] && Object.keys(conflicts[id]).length > 0) continue;
      const contact = await prisma.contact.findUnique({
        where: { id },
        include: { emails: true, phones: true, addresses: true },
      });
      if (!contact) continue;

      const primaryEmail = contact.emails[0]?.email ?? contact.email;
      const primaryPhone = contact.phones[0]?.phone ?? contact.phone;
      if (!primaryEmail && !contact.name) continue;

      try {
        if (contact.googleResourceName) {
          const person = await people.people.get({
            resourceName: contact.googleResourceName,
            personFields: "metadata,memberships",
          });
          const personEtag = person.data?.etag || person.data?.metadata?.sources?.[0]?.etag || null;
          const membershipResourceNames = extractMembershipResourceNamesFromPerson(person.data);
          await updateGoogleContactFromLocal({
            googleResourceName: contact.googleResourceName,
            name: contact.name,
            firstName: contact.firstName,
            lastName: contact.lastName,
            company: contact.company,
            jobTitle: contact.jobTitle,
            notes: contact.notes,
            label: contact.label,
            isPriority: contact.isPriority,
            emails:
              contact.emails.length > 0
                ? contact.emails
                : primaryEmail
                  ? [{ email: primaryEmail }]
                  : [],
            phones:
              contact.phones.length > 0
                ? contact.phones
                : primaryPhone
                  ? [{ phone: primaryPhone }]
                  : [],
            addresses: contact.addresses,
            currentEtag: personEtag,
            currentMembershipResourceNames: membershipResourceNames,
          });
        } else {
          const created = await people.people.createContact({
            requestBody: buildLocalGooglePersonRequest({
              name: contact.name,
              firstName: contact.firstName,
              lastName: contact.lastName,
              company: contact.company,
              jobTitle: contact.jobTitle,
              notes: contact.notes,
              emails:
                contact.emails.length > 0
                  ? contact.emails
                  : primaryEmail
                    ? [{ email: primaryEmail }]
                    : [],
              phones:
                contact.phones.length > 0
                  ? contact.phones
                  : primaryPhone
                    ? [{ phone: primaryPhone }]
                    : [],
              addresses: contact.addresses,
            }),
          });
          if (created.data.resourceName) {
            await prisma.contact.update({
              where: { id },
              data: { googleResourceName: created.data.resourceName, source: "google" },
            });
            const createdPerson = await people.people.get({
              resourceName: created.data.resourceName,
              personFields: "metadata",
            });
            const createdEtag =
              createdPerson.data?.etag || createdPerson.data?.metadata?.sources?.[0]?.etag || null;
            if (createdEtag) {
              await people.people.updateContact({
                resourceName: created.data.resourceName,
                updatePersonFields: "memberships",
                requestBody: {
                  resourceName: created.data.resourceName,
                  etag: createdEtag,
                  memberships: await buildGoogleMemberships(contact.label ?? null, !!contact.isPriority, []),
                },
              });
            }
          }
        }
        pushed++;
      } catch (e) {
        console.error("Push contact error:", e);
        failures.push({
          id,
          name: contact.name,
          stage: "push_local",
          message: e instanceof Error ? e.message : "Push contact failed",
        });
      }
    }

    return NextResponse.json({ imported, pushed, failures });
  } catch (err) {
    console.error("Sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
