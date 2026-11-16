// The admin site's security decisions as pure functions, so they can be tested
// without a server: which proxy paths and methods are allowed, the same-origin
// and CSRF check for writes, the safe `next` path after sign-in, and the cookie
// lifetime. Used by middleware.ts and the /admin/api route handlers.

/** One path segment: letters, digits and a few separators. Never "." or "..". */
const SEGMENT = /^[A-Za-z0-9_.:@-]+$/;

export function isSafeSegment(s: string): boolean {
  return SEGMENT.test(s) && s !== "." && s !== "..";
}

/** The API path under /api/admin for these segments, or null when any segment is unsafe. */
export function proxyPath(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > 8) return null;
  if (!segments.every(isSafeSegment)) return null;
  return segments.join("/");
}

/** The only writes the site may make through the proxy. */
const WRITES: readonly RegExp[] = [/^wallet\/adjust$/, /^deposits\/[A-Za-z0-9_.:@-]+\/resolve$/];

export type MethodRule = "read" | "write" | "deny";

/** GET reads any safe path; POST only the allowlisted writes; anything else is refused (405). */
export function methodRule(method: string, path: string): MethodRule {
  const m = method.toUpperCase();
  if (m === "GET") return "read";
  if (m === "POST" && WRITES.some((re) => re.test(path))) return "write";
  return "deny";
}

/** True when `origin` is an http(s) URL on exactly the request's own host (host:port). */
export function sameOrigin(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Writes need both locks: our own Origin and the X-Admin-CSRF: 1 header (a cross-site form cannot set it). */
export function writeAllowed(h: { origin: string | null; host: string | null; csrf: string | null }): boolean {
  return h.csrf === "1" && sameOrigin(h.origin, h.host);
}

/**
 * Where to go after sign-in: only a same-site relative path inside /admin, never
 * the login page or the API, never protocol-relative ("//evil") or with a backslash.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 512) return "/admin";
  if (!raw.startsWith("/admin")) return "/admin";
  if (raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return "/admin";
  const path = raw.split(/[?#]/)[0];
  if (path !== "/admin" && !path.startsWith("/admin/")) return "/admin";
  if (path.startsWith("/admin/login") || path.startsWith("/admin/api")) return "/admin";
  if (path.split("/").some((s) => s === "." || s === ".." || /%2e/i.test(s))) return "/admin";
  return raw;
}

/** Cookie max-age in whole seconds until `expiresAt` (ms), at least 0. */
export function cookieMaxAge(expiresAt: number, now: number): number {
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}
