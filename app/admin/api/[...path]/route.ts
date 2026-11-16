// The admin proxy (BFF): the browser calls same-origin /admin/api/<path> and
// this handler calls the API's /api/admin/<path> with the session from the
// httpOnly cookie. Only safe paths, GET for reads and two allowlisted POSTs;
// writes need our own Origin and X-Admin-CSRF: 1. Nothing else is forwarded.

import { NextResponse, type NextRequest } from "next/server";
import { methodRule, proxyPath, writeAllowed } from "@/lib/admin/proxyRules";
import { callApi, clearSessionCookie, hostOf, sessionOf } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

const MAX_BODY = 16 * 1024;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path: segments = [] } = await ctx.params;
  const path = proxyPath(segments);
  if (!path) return json({ error: "bad path" }, 400);
  const rule = methodRule(req.method, path);
  if (rule === "deny") return json({ error: "method not allowed" }, 405);

  const session = sessionOf(req);
  if (!session) return json({ error: "sign in" }, 401);

  let body: unknown;
  if (rule === "write") {
    if (!writeAllowed({ origin: req.headers.get("origin"), host: hostOf(req), csrf: req.headers.get("x-admin-csrf") })) {
      return json({ error: "forbidden" }, 403);
    }
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "body too large" }, 413);
    try {
      body = JSON.parse(text || "{}");
    } catch {
      return json({ error: "send JSON" }, 400);
    }
  }

  const up = await callApi(path, {
    method: rule === "write" ? "POST" : "GET",
    headers: { "x-admin-session": session },
    body,
    search: req.nextUrl.searchParams.toString(),
  });
  if (!up) return json({ error: "The admin API cannot be reached right now." }, 502);
  if (up.status === 401) {
    const res = json({ error: "sign in" }, 401);
    clearSessionCookie(res);
    return res;
  }
  return json(up.body ?? {}, up.status);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
