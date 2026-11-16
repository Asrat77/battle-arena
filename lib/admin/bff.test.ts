// Calls the real /admin/api route handlers (no server) to check the proxy's locks:
// no cookie is 401, writes outside the allowlist are 405, writes without our Origin
// or X-Admin-CSRF are 403, and nothing reaches the API in any of those cases.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import * as proxy from "../../app/admin/api/[...path]/route";
import * as session from "../../app/admin/api/session/route";

const realFetch = globalThis.fetch;
let upstream: string[] = [];

beforeEach(() => {
  upstream = [];
  globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
    upstream.push(`${init?.method} ${String(url)}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const COOKIE = "ba_admin=" + "a".repeat(64);
const HOST = "admin.example.test";

function req(method: string, path: string, h: Record<string, string> = {}, body?: unknown) {
  return new NextRequest(`http://${HOST}${path}`, {
    method,
    headers: { host: HOST, ...h },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const handler = (m: string) => (proxy as unknown as Record<string, (r: NextRequest, c: ReturnType<typeof ctx>) => Promise<Response>>)[m];

describe("admin BFF proxy", () => {
  test("every method needs the cookie", async () => {
    for (const m of ["GET", "POST"]) {
      const p = m === "GET" ? "overview" : "wallet/adjust";
      const res = await handler(m)(req(m, `/admin/api/${p}`, { origin: `http://${HOST}`, "x-admin-csrf": "1" }, m === "POST" ? {} : undefined), ctx(p));
      assert.equal(res.status, 401, m);
    }
    assert.deepEqual(upstream, []);
  });

  test("writes outside the allowlist and other verbs are refused with a cookie", async () => {
    const ok = { cookie: COOKIE, origin: `http://${HOST}`, "x-admin-csrf": "1" };
    for (const [m, p] of [["POST", "wallet/summary"], ["POST", "withdrawals"], ["POST", "session"], ["PUT", "wallet/adjust"], ["POST", "deposits/x/resolve/extra"]] as const) {
      const res = await handler(m)(req(m, `/admin/api/${p}`, ok, {}), ctx(p));
      assert.equal(res.status, 405, `${m} ${p}`);
    }
    for (const m of ["PUT", "PATCH", "DELETE"]) {
      const res = await handler(m)(req(m, "/admin/api/wallet/adjust", ok, {}), ctx("wallet/adjust"));
      assert.equal(res.status, 405, m);
    }
    assert.deepEqual(upstream, []);
  });

  test("allowed writes need our own Origin and X-Admin-CSRF", async () => {
    const p = "wallet/adjust";
    const bad: Record<string, string>[] = [
      { cookie: COOKIE },
      { cookie: COOKIE, "x-admin-csrf": "1" },
      { cookie: COOKIE, origin: `http://${HOST}` },
      { cookie: COOKIE, origin: "http://evil.example", "x-admin-csrf": "1" },
      { cookie: COOKIE, origin: `http://${HOST}`, "x-admin-csrf": "0" },
    ];
    for (const h of bad) assert.equal((await handler("POST")(req("POST", `/admin/api/${p}`, h, {}), ctx(p))).status, 403, JSON.stringify(h));
    assert.deepEqual(upstream, []);
    const good = await handler("POST")(req("POST", `/admin/api/${p}`, { cookie: COOKIE, origin: `http://${HOST}`, "x-admin-csrf": "1" }, {}), ctx(p));
    assert.equal(good.status, 200);
    assert.equal(upstream.length, 1);
  });

  test("unsafe paths are refused and only the session header goes upstream", async () => {
    const res = await handler("GET")(req("GET", "/admin/api/..%2Fhealth", { cookie: COOKIE }), { params: Promise.resolve({ path: ["..", "health"] }) });
    assert.equal(res.status, 400);
    assert.deepEqual(upstream, []);
    let seen: Record<string, string> = {};
    globalThis.fetch = (async (_u: unknown, init?: { headers?: Record<string, string> }) => {
      seen = init?.headers ?? {};
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await handler("GET")(req("GET", "/admin/api/overview", { cookie: COOKIE, authorization: "Bearer x" }), ctx("overview"));
    assert.deepEqual(Object.keys(seen).sort(), ["accept", "x-admin-session"]);
  });

  test("sign-in and sign-out need Origin and the CSRF header; whoami needs the cookie", async () => {
    assert.equal((await session.POST(req("POST", "/admin/api/session", {}, { token: "t", name: "a" }))).status, 403);
    assert.equal((await session.DELETE(req("DELETE", "/admin/api/session", { cookie: COOKIE }))).status, 403);
    assert.equal((await session.GET(req("GET", "/admin/api/session"))).status, 401);
    assert.deepEqual(upstream, []);
  });
});
