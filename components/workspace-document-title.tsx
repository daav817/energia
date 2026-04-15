"use client";

import { useEffect } from "react";

const SUFFIX = " - Energia CRM";

/** Tab titles aligned with main nav; unknown routes fall back to product name only. */
export function workspacePageTitleForPath(pathname: string): string {
  const p = pathname || "";
  if (p === "/" || p.startsWith("/dashboard")) return `Dashboard${SUFFIX}`;
  if (p.startsWith("/inbox")) return `Emails${SUFFIX}`;
  if (p.startsWith("/drive")) return `Drive${SUFFIX}`;
  if (p.startsWith("/contacts")) return `Contacts${SUFFIX}`;
  if (p.startsWith("/schedule")) return `Calendar${SUFFIX}`;
  if (p.startsWith("/tasks")) return `Tasks${SUFFIX}`;
  if (p.startsWith("/directory/contracts")) return `Contracts${SUFFIX}`;
  if (p.startsWith("/rfp")) return `RFP${SUFFIX}`;
  if (p.startsWith("/quotes")) return `Quotes${SUFFIX}`;
  if (p.startsWith("/news")) return `News${SUFFIX}`;
  return "Energia CRM";
}

export function WorkspaceDocumentTitle({ pathname }: { pathname: string }) {
  useEffect(() => {
    document.title = workspacePageTitleForPath(pathname);
  }, [pathname]);
  return null;
}
