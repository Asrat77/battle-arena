// HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, describe, test } from "node:test";
import { createApp } from "../app";
import { RateLimiter } from "../rateLimit";
import { MemoryStore } from "../store";
import { BIRR } from "../wallet";
import { AdminAudit, AUDIT_KEEP, AUDIT_KEY } from "./adminAudit";
import { SESSION_TTL_MS } from "./adminAuth";

const TOKEN = "test-admin-token-" + "q".repeat(16);

type Srv = Awaited<ReturnType<typeof start>>;
const open: { close(): void }[] = [];
after(() => open.forEach((s) => s.close()));

async function start(tokenArg: string | null = TOKEN) {
  const token = tokenArg ?? undefined;
  let t = Date.UTC(2026, 10, 15, 9);
  const store = new MemoryStore();
  const app = createApp({ store, db: null, wallet: { mode: "play" }, admin: { now: () => t, token: () => token } });
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  const url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
    const res = await fetch(url + path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const srv = {
    ...app,
    store,
    call,
    advance: (ms: number) => (t += ms),
    signIn: (name = "asrat", tok = TOKEN) => call("POST", "/api/admin/session", { "x-admin-token": tok }, { name }),
    close: () => {
      app.io.close();
      app.httpServer.close();
    },
  };
  open.push(srv);
  return srv;
}

const audit = (s: Srv) => s.store.read<any[]>(AUDIT_KEY, []);

describe("admin guard", () => {
  test("404 on every admin route without ADMIN_TOKEN or with a short one", async () => {
    for (const tok of [null, "short-token"]) {
      const s = await start(tok);
      for (const [m, p] of [
        ["GET", "/api/admin/wallet/reconcile"],
        ["GET", "/api/admin/audit"],
        ["GET", "/api/admin/session"],
        ["POST", "/api/admin/session"],
        ["GET", "/api/admin/nope"],
      ]) {
        const r = await s.call(m, p, { "x-admin-token": tok ?? "x" }, m === "POST" ? { name: "a" } : undefined);
        assert.equal(r.status, 404, `${m} ${p}`);
        assert.deepEqual(r.body, { error: "not found" });
      }
    }
  });

  test("401 without credentials, with a wrong token, and with an unknown session", async () => {
    const s = await start();
    assert.equal((await s.call("GET", "/api/admin/wallet/reconcile")).status, 401);
    assert.equal((await s.call("GET", "/api/admin/wallet/reconcile", { "x-admin-token": "w".repeat(32) })).status, 401);
    assert.equal((await s.call("GET", "/api/admin/audit", { "x-admin-session": "0".repeat(64) })).status, 401);
    assert.equal((await s.signIn("asrat", "w".repeat(32))).status, 401);
    const ok = await s.call("GET", "/api/admin/wallet/reconcile", { "x-admin-token": TOKEN });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    // Guarded but unknown paths answer JSON 404.
    assert.equal((await s.call("GET", "/api/admin/nope", { "x-admin-token": TOKEN })).status, 404);
  });

  test("raw token caller: GET /session has no name", async () => {
    const s = await start();
    assert.deepEqual((await s.call("GET", "/api/admin/session", { "x-admin-token": TOKEN })).body, { name: null, expiresAt: null });
  });
});

describe("admin sessions", () => {
  test("sign in, use the session on reconcile, sign out", async () => {
    const s = await start();
    const r = await s.signIn("  asrat  ");
    assert.equal(r.status, 200);
    assert.match(r.body.session, /^[0-9a-f]{64}$/);
    assert.equal(r.body.name, "asrat");
    assert.equal(r.body.expiresAt, Date.UTC(2026, 10, 15, 9) + SESSION_TTL_MS);
    const h = { "x-admin-session": r.body.session };
    assert.deepEqual((await s.call("GET", "/api/admin/session", h)).body, { name: "asrat", expiresAt: r.body.expiresAt });
    const rec = await s.call("GET", "/api/admin/wallet/reconcile", h);
    assert.equal(rec.status, 200);
    assert.equal(rec.body.ok, true);
    assert.equal((await s.call("GET", "/api/admin/wallet/fees?book=play", h)).body.book, "play");
    assert.equal((await s.call("DELETE", "/api/admin/session", h)).status, 200);
    assert.equal((await s.call("GET", "/api/admin/wallet/reconcile", h)).status, 401);
  });

  test("name is required, 1 to 40 characters, and may not hold the token", async () => {
    const s = await start();
    for (const name of ["", "   ", "x".repeat(41), `me ${TOKEN}`, 42 as any]) assert.equal((await s.signIn(name)).status, 400, String(name));
    assert.equal((await s.signIn("x".repeat(40))).status, 200);
  });

  test("a session expires after 12 hours", async () => {
    const s = await start();
    const h = { "x-admin-session": (await s.signIn()).body.session };
    s.advance(SESSION_TTL_MS - 1);
    assert.equal((await s.call("GET", "/api/admin/session", h)).status, 200);
    s.advance(1);
    assert.equal((await s.call("GET", "/api/admin/session", h)).status, 401);
  });

  test("live sessions are capped; the oldest goes first", async () => {
    const s = await start();
    const first = (await s.signIn("first")).body.session;
    for (let i = 0; i < 20; i++) assert.equal((await s.signIn(`a${i}`)).status, 200);
    assert.equal((await s.call("GET", "/api/admin/session", { "x-admin-session": first })).status, 401);
  });

  test("DELETE /session with the raw token has nothing to end", async () => {
    const s = await start();
    assert.equal((await s.call("DELETE", "/api/admin/session", { "x-admin-token": TOKEN })).status, 400);
  });
});

describe("sign-in limiter", () => {
  test("429 after 10 failures from one IP; the right token is refused while locked", async () => {
    const s = await start();
    for (let i = 0; i < 10; i++) assert.equal((await s.signIn("x", "bad".repeat(10))).status, 401);
    assert.equal((await s.signIn("asrat")).status, 429);
    assert.equal((await s.call("GET", "/api/admin/wallet/reconcile", { "x-admin-token": TOKEN })).status, 429);
    s.advance(15 * 60 * 1000 + 1);
    assert.equal((await s.signIn("asrat")).status, 200);
  });

  test("wrong tokens on other admin routes count too; a live session still works", async () => {
    const s = await start();
    const h = { "x-admin-session": (await s.signIn()).body.session };
    for (let i = 0; i < 10; i++) assert.equal((await s.call("GET", "/api/admin/audit", { "x-admin-token": "bad".repeat(10) })).status, 401);
    assert.equal((await s.signIn()).status, 429);
    assert.equal((await s.call("GET", "/api/admin/audit", h)).status, 200);
  });

  test("RateLimiter.blocked/record count only what is recorded; take is unchanged", () => {
    let t = 0;
    const l = new RateLimiter(2, 100, () => t);
    assert.equal(l.blocked("ip"), false);
    l.record("ip");
    l.record("ip");
    assert.equal(l.blocked("ip"), true);
    assert.equal(l.take("ip"), false);
    t = 101;
    assert.equal(l.blocked("ip"), false);
    assert.equal(l.take("ip"), true);
    assert.equal(l.take("ip"), true);
    assert.equal(l.take("ip"), false);
  });
});

describe("admin audit", () => {
  test("records signin, signin-failed, signout and wallet-adjust, and never the token or session", async () => {
    const s = await start();
    await s.signIn("asrat", "bad".repeat(10));
    const session = (await s.signIn("asrat")).body.session;
    const h = { "x-admin-session": session };
    const me = s.identity.signup("Alice").profile;
    s.wallet.faucet(me.id);
    const adj = await s.call("POST", "/api/admin/wallet/adjust", h, { book: "play", profileId: me.id, amount: 5 * BIRR, reason: "bug refund", by: "someone-else" });
    assert.equal(adj.status, 200);
    assert.equal(adj.body.txn.by, "admin:asrat", "session name wins over body `by`");
    // A failed adjust is not audited.
    assert.equal((await s.call("POST", "/api/admin/wallet/adjust", h, { book: "play", profileId: me.id, amount: 5, reason: "" })).status, 400);
    await s.call("DELETE", "/api/admin/session", h);

    const rows = audit(s);
    assert.deepEqual(
      rows.map((r) => [r.action, r.actor]),
      [
        ["signin-failed", "unknown"],
        ["signin", "asrat"],
        ["wallet-adjust", "asrat"],
        ["signout", "asrat"],
      ],
    );
    const a = rows[2];
    assert.equal(a.target, me.id);
    assert.deepEqual(a.detail, { book: "play", amount: 5 * BIRR, reason: "bug refund", txn: adj.body.txn.id, by: "admin:asrat" });
    assert.ok(rows.every((r) => typeof r.id === "string" && typeof r.ts === "number" && r.ip));

    const text = JSON.stringify(s.store.read(AUDIT_KEY, null));
    assert.ok(!text.includes(TOKEN), "token in audit");
    assert.ok(!text.includes(session), "session in audit");
    assert.ok(!text.includes(session.slice(0, 16)), "part of session in audit");
  });

  test("raw-token adjust keeps today's `by` and audits as token", async () => {
    const s = await start();
    const me = s.identity.signup("Bob").profile;
    const adj = await s.call("POST", "/api/admin/wallet/adjust", { "x-admin-token": TOKEN }, { book: "play", profileId: me.id, amount: BIRR, reason: "gift", by: "ops" });
    assert.equal(adj.body.txn.by, "admin:ops");
    const plain = await s.call("POST", "/api/admin/wallet/adjust", { "x-admin-token": TOKEN }, { book: "play", profileId: me.id, amount: BIRR, reason: "gift" });
    assert.equal(plain.body.txn.by, "admin");
    const rows = audit(s);
    assert.deepEqual(rows.map((r) => [r.action, r.actor]), [["wallet-adjust", "token"], ["wallet-adjust", "token"]]);
  });

  test("a reason that contains the token is redacted", async () => {
    const s = await start();
    const me = s.identity.signup("Cid").profile;
    await s.call("POST", "/api/admin/wallet/adjust", { "x-admin-token": TOKEN }, { book: "play", profileId: me.id, amount: BIRR, reason: `oops ${TOKEN}` });
    assert.ok(!JSON.stringify(s.store.read(AUDIT_KEY, null)).includes(TOKEN));
  });

  test("GET /audit pages newest first, limit max 200", async () => {
    const s = await start();
    const h = { "x-admin-session": (await s.signIn("one")).body.session };
    await s.signIn("two");
    await s.signIn("three");
    const r = await s.call("GET", "/api/admin/audit?page=0&limit=2", h);
    assert.equal(r.body.total, 3);
    assert.deepEqual(r.body.rows.map((x: any) => x.actor), ["three", "two"]);
    const p1 = await s.call("GET", "/api/admin/audit?page=1&limit=2", h);
    assert.deepEqual(p1.body.rows.map((x: any) => x.actor), ["one"]);
    const store = new MemoryStore();
    const log = new AdminAudit(store);
    for (let i = 0; i < 250; i++) log.add({ actor: "token", action: "signout" });
    assert.equal(log.page(0, 1000).rows.length, 200);
  });

  test("GET /audit filters by action and by actor, target or ip text", async () => {
    const s = await start();
    const h = { "x-admin-session": (await s.signIn("Dawit")).body.session };
    await s.signIn("Sara", "wrong-token-" + "x".repeat(10));
    new AdminAudit(s.store).add({ actor: "Sara", action: "wallet-adjust", target: "player-77", ip: "10.1.2.3" });
    const by = async (qs: string) => (await s.call("GET", "/api/admin/audit?" + qs, h)).body;
    assert.deepEqual((await by("action=signin-failed")).rows.map((x: any) => x.action), ["signin-failed"]);
    assert.equal((await by("action=signin,wallet-adjust")).total, 2);
    assert.equal((await by("q=SARA")).total, 1);
    assert.equal((await by("q=player-77")).rows[0].action, "wallet-adjust");
    assert.equal((await by("q=10.1.2")).total, 1);
    assert.equal((await by("action=signout")).total, 0);
    assert.equal((await by("")).total, 3);
  });

  test("keeps the newest 2000 entries", () => {
    const store = new MemoryStore();
    const log = new AdminAudit(store);
    for (let i = 0; i < AUDIT_KEEP + 5; i++) log.add({ actor: `a${i}`, action: "signin" });
    const all = store.read<any[]>(AUDIT_KEY, []);
    assert.equal(all.length, AUDIT_KEEP);
    assert.equal(all[0].actor, "a5");
  });

  test("the token never reaches the console", async () => {
    const s = await start();
    const seen: string[] = [];
    const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => void seen.push(a.map(String).join(" "));
    try {
      await s.signIn("asrat", "bad".repeat(10));
      const session = (await s.signIn("asrat")).body.session;
      const me = s.identity.signup("Dee").profile;
      await s.call("POST", "/api/admin/wallet/adjust", { "x-admin-session": session }, { book: "play", profileId: me.id, amount: BIRR, reason: "gift" });
      await s.call("DELETE", "/api/admin/session", { "x-admin-session": session });
      const out = seen.join("\n");
      assert.ok(!out.includes(TOKEN) && !out.includes(session));
    } finally {
      Object.assign(console, orig);
    }
  });
});
