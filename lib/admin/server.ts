// Server-only helpers for the admin BFF (the /admin/api route handlers). This
// module must never be imported from a client component: it reads the session
// cookie and talks to the API server to server. (The `server-only` package is
// not installed, so this comment is the guard; nothing here holds a secret.)

import type { NextRequest, NextResponse } from "next/server";
import { cookieMaxAge } from "./proxyRules";

/** The API, server to server. ADMIN_API_URL lets the web container use an internal address. */
export const ADMIN_API = (process.env.ADMIN_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/$/, "");

export const ADMIN_COOKIE = "ba_admin";

const baseCookie = () => ({
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/admin",
  secure: process.env.NODE_ENV === "production",
});

export function setSessionCookie(res: NextResponse, session: string, expiresAt: number) {
  res.cookies.set(ADMIN_COOKIE, session, { ...baseCookie(), maxAge: cookieMaxAge(expiresAt, Date.now()) });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, "", { ...baseCookie(), maxAge: 0 });
}

export function sessionOf(req: NextRequest): string | null {
  const v = req.cookies.get(ADMIN_COOKIE)?.value;
  // A session id is 64 hex characters; anything else is not worth sending on.
  return v && /^[A-Za-z0-9_-]{16,200}$/.test(v) ? v : null;
}

/** The request's own host, for the Origin check. */
export function hostOf(req: NextRequest): string | null {
  return req.headers.get("host");
}

export interface Upstream {
  status: number;
  body: unknown;
}

/**
 * One call to the API. Sends only the headers given here (never the browser's
 * cookies or other headers). Returns null when the API cannot be reached.
 */
export async function callApi(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown; search?: string },
): Promise<Upstream | null> {
  const headers: Record<string, string> = { accept: "application/json", ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await fetch(`${ADMIN_API}/api/admin/${path}${init.search ? `?${init.search}` : ""}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: `unexpected answer (${res.status})` };
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** A clean error message from an API body, without echoing anything unexpected. */
export function errorOf(body: unknown, fallback: string): string {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === "string" && e.length <= 300 ? e : fallback;
}
