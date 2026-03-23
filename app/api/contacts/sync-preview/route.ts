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
  }>;
};

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

    const normalizeName = (raw: unknown) => String(raw ?? "")
      .trim()
      .toLowerCase();
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

      const labels = groupResourceNames.map(
        (rn) => {
          const token = String(rn.split("/").pop() || "").toLowerCase();
          if (token === "starred") {
            isStarred = true;
            return "";
          }
          if (token === "mycontacts") return "";
          return contactGroupDisplayNameByResourceName.get(rn) || (rn.split("/").pop() || rn);
        }
      );

      const cleaned = Array.from(new Set(labels.map((l) => String(l).trim()).filter(Boolean)));
      return { label: cleaned.join(", "), isStarred };
    };

    const googleConnections: any[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const res: { data: { connections?: any[]; nextPageToken?: string | null } } = await people.people.connections.list({
        resourceName: "people/me",
        pageSize: 500,
        pageToken,
        personFields: "names,emailAddresses,phoneNumbers,organizations,memberships",
      });

      googleConnections.push(...(res.data.connections || []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    const localContacts = await prisma.contact.findMany({
      include: {
        emails: true,
        phones: true,
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
        const company = p.organizations?.[0]?.name;
        const { label, isStarred } = extractLabelStringFromPerson(p);
        return [
          p.resourceName!,
          {
            name,
            email,
            phone,
            emailList,
            phoneList,
            company,
            label,
            isStarred,
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

      if (local.googleResourceName) {
        const g = googleByResource.get(local.googleResourceName);
        if (g) {
          const localEmailNorm = normalizeEmail(primaryEmail);
          const googleEmailNorm = normalizeEmail(g.email);
          const localPhoneNorm = normalizePhone(primaryPhone);
          const googlePhoneNorm = normalizePhone(g.phone);

          const localChanged =
            normalizeName(local.name) !== normalizeName(g.name) ||
            localEmailNorm !== googleEmailNorm ||
            localPhoneNorm !== googlePhoneNorm ||
            normalizeLabelString(local.label) !== normalizeLabelString(g.label) ||
            (local.isPriority ?? false) !== (g.isStarred ?? false);
          if (localChanged) {
            preview.conflicts.push({
              localId: local.id,
              googleResourceName: local.googleResourceName,
              name: local.name,
              localChanges: `${local.name} | ${primaryEmail || ""} | ${primaryPhone || ""} | ${local.label || ""} | star=${local.isPriority ? "yes" : "no"}`,
              googleChanges: `${g.name} | ${g.email || ""} | ${g.phone || ""} | ${g.label || ""} | star=${g.isStarred ? "yes" : "no"}`,
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
