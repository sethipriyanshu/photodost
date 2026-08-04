import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Gate the owner-facing surface. We do a fast, optimistic cookie check here
 * (no DB hit) and let the page-level `requireWorkspace()` do the authoritative
 * session + workspace resolution. Public guest routes (/g), the auth API,
 * and the marketing landing page stay open.
 */
const PROTECTED_PREFIXES = ["/app", "/events", "/onboarding"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isProtected) return NextResponse.next();

  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on app pages but skip static assets and the auth API. We intentionally
  // do NOT match /api/* here — management API routes enforce auth themselves
  // (so they can return JSON 401s instead of HTML redirects).
  matcher: ["/app/:path*", "/events/:path*", "/onboarding/:path*"],
};
