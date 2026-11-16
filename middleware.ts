// Admin site gatekeeping in front of every /admin request: security headers on
// all responses, and a redirect to the login page when there is no session
// cookie (or away from it when there is one). This is only a convenience; the
// API checks the session on every call and is the real gate.

import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/admin/proxyRules";

const COOKIE = "ba_admin";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function secure(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const signedIn = Boolean(req.cookies.get(COOKIE)?.value);

  // The BFF answers 401 JSON itself.
  if (pathname === "/admin/api" || pathname.startsWith("/admin/api/")) return secure(NextResponse.next());

  const isLogin = pathname === "/admin/login" || pathname.startsWith("/admin/login/");
  if (isLogin && signedIn) {
    // safeNext only returns a relative path inside /admin, so this stays on our origin.
    return secure(NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next")), req.url)));
  }
  if (!isLogin && !signedIn) {
    const next = safeNext(pathname + search);
    const to = new URL("/admin/login", req.url);
    if (next !== "/admin") to.searchParams.set("next", next);
    return secure(NextResponse.redirect(to));
  }
  return secure(NextResponse.next());
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
