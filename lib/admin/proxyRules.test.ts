import assert from "node:assert/strict";
import { test } from "node:test";
import { cookieMaxAge, isSafeSegment, methodRule, proxyPath, safeNext, sameOrigin, writeAllowed } from "./proxyRules";

test("path segments: only safe characters, never . or ..", () => {
  for (const ok of ["users", "u_1", "a.b", "abc-123", "x:y", "@me", "deposits"]) assert.ok(isSafeSegment(ok), ok);
  for (const bad of ["", ".", "..", "a/b", "a b", "%2e%2e", "a?b", "a#b", "a\\b", "é", "a\nb"]) assert.ok(!isSafeSegment(bad), bad);
  assert.equal(proxyPath(["users", "abc"]), "users/abc");
  assert.equal(proxyPath([]), null);
  assert.equal(proxyPath(["..", "health"]), null);
  assert.equal(proxyPath(["users", "."]), null);
  assert.equal(proxyPath(Array(9).fill("a")), null);
});

test("methods: GET reads anything, POST only the two writes, the rest is denied", () => {
  assert.equal(methodRule("GET", "users"), "read");
  assert.equal(methodRule("get", "wallet/adjust"), "read");
  assert.equal(methodRule("POST", "wallet/adjust"), "write");
  assert.equal(methodRule("POST", "deposits/dep_12/resolve"), "write");
  assert.equal(methodRule("POST", "deposits/resolve"), "deny");
  assert.equal(methodRule("POST", "deposits/a/b/resolve"), "deny");
  assert.equal(methodRule("POST", "wallet/adjust/x"), "deny");
  assert.equal(methodRule("POST", "session"), "deny");
  assert.equal(methodRule("POST", "users"), "deny");
  for (const m of ["PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) assert.equal(methodRule(m, "wallet/adjust"), "deny", m);
});

test("origin must be exactly our own host", () => {
  assert.ok(sameOrigin("https://admin.example.com", "admin.example.com"));
  assert.ok(sameOrigin("http://localhost:3000", "localhost:3000"));
  assert.ok(!sameOrigin("http://localhost:3001", "localhost:3000"));
  assert.ok(!sameOrigin("https://evil.com", "admin.example.com"));
  assert.ok(!sameOrigin("https://admin.example.com.evil.com", "admin.example.com"));
  assert.ok(!sameOrigin("null", "admin.example.com"));
  assert.ok(!sameOrigin(null, "admin.example.com"));
  assert.ok(!sameOrigin("https://admin.example.com", null));
  assert.ok(!sameOrigin("javascript:alert(1)", "alert(1)"));
});

test("writes need both the origin and the CSRF header", () => {
  const host = "localhost:3000";
  assert.ok(writeAllowed({ origin: "http://localhost:3000", host, csrf: "1" }));
  assert.ok(!writeAllowed({ origin: "http://localhost:3000", host, csrf: null }));
  assert.ok(!writeAllowed({ origin: "http://localhost:3000", host, csrf: "true" }));
  assert.ok(!writeAllowed({ origin: "https://evil.com", host, csrf: "1" }));
  assert.ok(!writeAllowed({ origin: null, host, csrf: "1" }));
});

test("next path: only relative paths inside /admin", () => {
  assert.equal(safeNext("/admin/players/abc?tab=wallet"), "/admin/players/abc?tab=wallet");
  assert.equal(safeNext("/admin"), "/admin");
  assert.equal(safeNext("/admin?days=7"), "/admin?days=7");
  for (const bad of [
    null,
    "",
    "https://evil.com/admin",
    "//evil.com/admin",
    "/administrator",
    "/admin/login",
    "/admin/login?next=/admin",
    "/admin/api/users",
    "/admin/../wallet",
    "/admin/%2e%2e/wallet",
    "/admin\\@evil.com",
    "/wallet",
    "/admin/\n",
  ]) {
    assert.equal(safeNext(bad), "/admin", String(bad));
  }
});

test("cookie max-age counts whole seconds to expiry", () => {
  assert.equal(cookieMaxAge(10_000 + 12 * 3600_000, 10_000), 12 * 3600);
  assert.equal(cookieMaxAge(5_000, 10_000), 0);
  assert.equal(cookieMaxAge(Number.NaN, 0), 0);
});
