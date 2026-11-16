// Sweeps every /api/admin route found in the live Express router, so a route added
// later is covered without touching this file: 401 without credentials (also with an
// unknown session), and 404 for everything when ADMIN_TOKEN is unset.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, describe, test } from "node:test";
import { createApp } from "../app";
import { MemoryStore } from "../store";

const TOKEN = "sweep-admin-token-" + "z".repeat(16);

/** Every [method, path] under /api/admin in the app's router tree (":param" filled with "x"). */
function adminRoutes(app: any): [string, string][] {
  const out: [string, string][] = [];
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) {
          if (typeof p !== "string" || !p.startsWith("/api/admin")) continue;
          for (const m of Object.keys(layer.route.methods)) out.push([m.toUpperCase(), p.replace(/:[A-Za-z]+/g, "x")]);
        }
      } else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk(app._router.stack);
  return out;
}

const open: { close(): void }[] = [];
after(() => open.forEach((s) => s.close()));

async function start(token: string | undefined) {
  const a = createApp({ store: new MemoryStore(), db: null, wallet: { mode: "play" }, admin: { token: () => token } });
  await new Promise<void>((r) => a.httpServer.listen(0, r));
  open.push({ close: () => { a.io.close(); a.httpServer.close(); } });
  const url = `http://localhost:${(a.httpServer.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url + path, { method, headers: { ...headers, "content-type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
    return res.status;
  };
  return { a, call };
}

describe("admin route sweep", () => {
  test("the router lists a sensible set of routes", async () => {
    const { a } = await start(TOKEN);
    const routes = adminRoutes(a.app);
    assert.ok(routes.length >= 20, `only ${routes.length} routes found`);
    assert.ok(routes.some(([m, p]) => m === "POST" && p === "/api/admin/wallet/adjust"));
  });

  test("every route answers 401 without credentials and with an unknown session (wrong tokens are covered in adminAuth.test.ts; they trip the sign-in limiter)", async () => {
    const { a, call } = await start(TOKEN);
    for (const [m, p] of adminRoutes(a.app)) {
      assert.equal(await call(m, p), 401, `${m} ${p} (none)`);
      assert.equal(await call(m, p, { "x-admin-session": "0".repeat(64) }), 401, `${m} ${p} (unknown session)`);
    }
  });

  test("every route answers 404 when ADMIN_TOKEN is unset or too short, even with a token", async () => {
    for (const tok of [undefined, "short"]) {
      const { a, call } = await start(tok);
      for (const [m, p] of adminRoutes(a.app)) {
        assert.equal(await call(m, p, { "x-admin-token": TOKEN }), 404, `${m} ${p} (token ${tok ?? "unset"})`);
      }
    }
  });
});
