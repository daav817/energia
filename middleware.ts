import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Legacy URLs used `/communications/*`; app routes now live at `/mail`, `/inbox`, etc. */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/communications") {
    return NextResponse.redirect(new URL(`/mail${search}`, request.url));
  }
  if (pathname.startsWith("/communications/")) {
    const nextPath = pathname.slice("/communications".length);
    return NextResponse.redirect(new URL(`${nextPath}${search}`, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/communications", "/communications/:path*"],
};
