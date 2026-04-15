import { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveClient } from "@/lib/gmail";
import { fileHasAnyoneLinkAccess } from "@/lib/google-drive-anyone-link-access";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FIELDS =
  "files(id,name,mimeType,webViewLink,iconLink,modifiedTime,parents,size,owners(displayName,emailAddress)),nextPageToken";

type Breadcrumb = {
  id: string;
  name: string;
};

type FolderLabel = {
  id: string;
  name: string;
  parents: string[];
};

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function allowedMimeTypes(kind: string) {
  if (kind === "bill") {
    return ["application/pdf", "image/"];
  }
  if (kind === "summary") {
    return [
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
  }
  if (kind === "reference") {
    return [];
  }
  return [];
}

async function getFolderLabel(
  drive: Awaited<ReturnType<typeof getGoogleDriveClient>>,
  folderId: string
): Promise<FolderLabel> {
  if (folderId === "root") {
    return { id: "root", name: "My Drive", parents: [] };
  }

  const response = await drive.files.get({
    fileId: folderId,
    fields: "id,name,parents",
    supportsAllDrives: false,
  });

  return {
    id: response.data.id || folderId,
    name: response.data.name || "Folder",
    parents: response.data.parents || [],
  };
}

async function buildBreadcrumbs(
  drive: Awaited<ReturnType<typeof getGoogleDriveClient>>,
  currentFolderId: string,
  rootFolderId?: string
): Promise<Breadcrumb[]> {
  const chain: Breadcrumb[] = [];
  let nextId: string | undefined = currentFolderId;

  while (nextId) {
    const folder = await getFolderLabel(drive, nextId);
    chain.push({ id: folder.id, name: folder.name });
    if (nextId === "root" || (rootFolderId && nextId === rootFolderId)) break;
    nextId = folder.parents?.[0];
  }

  return chain.reverse();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get("query") || "").trim();
    const kind = String(searchParams.get("kind") || "all").trim().toLowerCase();
    const requestedFolderId = String(searchParams.get("folderId") || "").trim();
    const configuredRootFolderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim() || undefined;
    const activeFolderId = requestedFolderId || configuredRootFolderId || "root";

    const drive = await getGoogleDriveClient();
    const qParts = ["trashed = false", `'${escapeDriveQuery(activeFolderId)}' in parents`];

    if (query) {
      qParts.push(`name contains '${escapeDriveQuery(query)}'`);
    }

    const mimeFilters = allowedMimeTypes(kind);
    if (mimeFilters.length > 0) {
      qParts.push(
        "(" +
          [
            `mimeType = '${FOLDER_MIME_TYPE}'`,
            ...mimeFilters.map((mime) =>
              mime.endsWith("/") ? `mimeType contains '${mime}'` : `mimeType = '${mime}'`
            ),
          ].join(" or ") +
        ")"
      );
    }

    const response = await drive.files.list({
      q: qParts.join(" and "),
      pageSize: 100,
      orderBy: "folder,name_natural",
      fields: DRIVE_FIELDS,
      supportsAllDrives: false,
      includeItemsFromAllDrives: false,
    });

    const breadcrumbs = await buildBreadcrumbs(drive, activeFolderId, configuredRootFolderId);

    const rawFiles = response.data.files || [];
    const CONCURRENCY = 8;
    const enriched: Array<{
      id: string | null | undefined;
      name: string | null | undefined;
      mimeType: string | null | undefined;
      webViewLink: string | null | undefined;
      iconLink: string | null | undefined;
      modifiedTime: string | null | undefined;
      parents: string[];
      size: number | null;
      ownerName: string | null;
      isFolder: boolean;
      anyoneWithLink: boolean;
    }> = [];

    for (let i = 0; i < rawFiles.length; i += CONCURRENCY) {
      const chunk = rawFiles.slice(i, i + CONCURRENCY);
      const part = await Promise.all(
        chunk.map(async (file) => {
          const isFolder = file.mimeType === FOLDER_MIME_TYPE;
          let anyoneWithLink = false;
          if (!isFolder && file.id) {
            try {
              anyoneWithLink = await fileHasAnyoneLinkAccess(drive, file.id);
            } catch {
              anyoneWithLink = false;
            }
          }
          return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink,
            iconLink: file.iconLink,
            modifiedTime: file.modifiedTime,
            parents: file.parents || [],
            size: file.size ? Number(file.size) : null,
            ownerName: file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || null,
            isFolder,
            anyoneWithLink,
          };
        })
      );
      enriched.push(...part);
    }

    return NextResponse.json({
      currentFolderId: activeFolderId,
      breadcrumbs,
      files: enriched,
    });
  } catch (error) {
    console.error("Google Drive file picker error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `${error.message}. If Drive access was just added, reconnect Google to grant Drive permissions.`
            : "Failed to load Google Drive files",
      },
      { status: 500 }
    );
  }
}
