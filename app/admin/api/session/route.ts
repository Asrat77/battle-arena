// Admin sign-in, whoami and sign-out for the browser. The token typed on the
// login page passes through here once, server to server, and is never stored
// or echoed; the API's session id goes only into the httpOnly ba_admin cookie.

import { NextResponse, type NextRequest } from "next/server";
import { writeAllowed } from "@/lib/admin/proxyRules";
import { callApi, clearSessionCookie, errorOf, hostOf, sessionOf, setSessionCookie } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const unreachable = () => json({ error: "The admin API cannot be reached right now." }, 502);

function guardWrite(req: NextRequest): NextResponse | null {
  const ok = writeAllowed({ origin: req.headers.get("origin"), host: hostOf(req), csrf: req.headers.get("x-admin-csrf") });
  return ok ? null : json({ error: "forbidden" }, 403);
}

/** Sign in: { token, name } → { name, expiresAt } and the cookie. */
export async function POST(req: NextRequest) {
  const refused = guardWrite(req);
  if (refused) return refused;
  let input: { token?: unknown; name?: unknown };
  try {
    input = await req.json();
  } catch {
    return json({ error: "Send the token and your name." }, 400);
  }
  const token = typeof input?.token === "string" ? input.token.trim() : "";
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!token || token.length > 512) return json({ error: "Enter the admin token." }, 400);
  if (!name) return json({ error: "Enter your name." }, 400);

  const up = await callApi("session", { method: "POST", headers: { "x-admin-token": token }, body: { name } });
  if (!up) return unreachable();
  if (up.status === 401 || up.status === 404) return json({ error: "That token is not right." }, 401);
  if (up.status === 429) return json({ error: "Too many failed attempts. Try again in about 15 minutes." }, 429);
  if (up.status === 400) return json({ error: errorOf(up.body, "Check your name.") }, 400);
  const body = up.body as { session?: unknown; name?: unknown; expiresAt?: unknown } | null;
  if (up.status !== 200 || typeof body?.session !== "string" || typeof body.expiresAt !== "number") {
    return json({ error: "Sign-in failed. Try again." }, 502);
  }
  const res = json({ name: body.name, expiresAt: body.expiresAt });
  setSessionCookie(res, body.session, body.expiresAt);
  return res;
}

/** Who is signed in: { name, expiresAt }, or 401 (and the cookie cleared). */
export async function GET(req: NextRequest) {
  const session = sessionOf(req);
  if (!session) return json({ error: "sign in" }, 401);
  const up = await callApi("session", { method: "GET", headers: { "x-admin-session": session } });
  if (!up) return unreachable();
  const body = up.body as { name?: unknown; expiresAt?: unknown } | null;
  if (up.status !== 200 || typeof body?.name !== "string") {
    const res = json({ error: "sign in" }, 401);
    clearSessionCookie(res);
    return res;
  }
  return json({ name: body.name, expiresAt: body.expiresAt });
}

/** Sign out: ends the API session and clears the cookie (even if the API is down). */
export async function DELETE(req: NextRequest) {
  const refused = guardWrite(req);
  if (refused) return refused;
  const session = sessionOf(req);
  if (session) await callApi("session", { method: "DELETE", headers: { "x-admin-session": session } });
  const res = json({ ok: true });
  clearSessionCookie(res);
  return res;
}
