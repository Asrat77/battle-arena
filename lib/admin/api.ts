"use client";

// The admin site's only way to reach data: same-origin /admin/api/* (the BFF
// adds the session server side). Writes carry X-Admin-CSRF: 1. A 401 anywhere
// sends the admin back to the login page with a `next` to return to.

import { useCallback, useEffect, useRef, useState } from "react";

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export type Params = Record<string, string | number | boolean | null | undefined>;

/** "a=1&b=x" from params, skipping null, undefined and "". */
export function queryString(params?: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  return q.toString();
}

let redirecting = false;

/** Go to the login page, remembering where we were. */
export function toLogin() {
  if (typeof window === "undefined" || redirecting) return;
  redirecting = true;
  const here = window.location.pathname + window.location.search;
  window.location.assign(here === "/admin" ? "/admin/login" : `/admin/login?next=${encodeURIComponent(here)}`);
}

async function request<T>(method: "GET" | "POST" | "DELETE", url: string, body?: unknown, signal?: AbortSignal, redirectOn401 = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        accept: "application/json",
        ...(method === "GET" ? {} : { "x-admin-csrf": "1" }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new AdminApiError(0, "Can't reach the server. Check your connection.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty or not JSON
  }
  if (res.status === 401 && redirectOn401) {
    toLogin();
    throw new AdminApiError(401, "Your admin session ended. Sign in again.");
  }
  if (!res.ok) {
    const e = (data as { error?: unknown } | null)?.error;
    throw new AdminApiError(res.status, typeof e === "string" ? e : `Request failed (${res.status})`);
  }
  return data as T;
}

/** GET /admin/api/<path>?<params>. `path` has no leading slash, e.g. "users" or `users/${id}`. */
export function adminGet<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  const qs = queryString(params);
  return request<T>("GET", `/admin/api/${path}${qs ? `?${qs}` : ""}`, undefined, signal);
}

/** POST /admin/api/<path> with a JSON body (only wallet/adjust and deposits/:id/resolve are allowed). */
export function adminPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", `/admin/api/${path}`, body);
}

/** Sign-in, whoami and sign-out (the BFF's own session route). */
export const adminSession = {
  signIn: (token: string, name: string) => request<{ name: string; expiresAt: number }>("POST", "/admin/api/session", { token, name }, undefined, false),
  whoami: (signal?: AbortSignal) => request<{ name: string; expiresAt: number | null }>("GET", "/admin/api/session", undefined, signal),
  signOut: () => request<{ ok: true }>("DELETE", "/admin/api/session"),
};

export interface AdminQuery<T> {
  data: T | null;
  error: AdminApiError | null;
  /** True while a request is in flight (also during a refresh, when `data` still holds the last answer). */
  loading: boolean;
  reload(): void;
}

/**
 * Fetch `path` with `params`; refetch when either changes, on `reload()`, and
 * every `refreshMs` when given. Pass `path = null` to wait. Keeps the last data
 * while the next page loads, and aborts on unmount or a newer request.
 */
export function useAdminQuery<T>(path: string | null, params?: Params, opts: { refreshMs?: number } = {}): AdminQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const key = path === null ? null : `${path}?${queryString(params)}`;
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (key === null || path === null) return;
    const ctrl = new AbortController();
    // A different query clears old data so a new page never shows the wrong rows as current.
    if (lastKey.current !== key) setData(null);
    lastKey.current = key;
    setLoading(true);
    adminGet<T>(path, params, ctrl.signal).then(
      (d) => {
        if (ctrl.signal.aborted) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (ctrl.signal.aborted || (err as Error)?.name === "AbortError") return;
        setError(err instanceof AdminApiError ? err : new AdminApiError(0, String(err)));
        setLoading(false);
      },
    );
    return () => ctrl.abort();
    // params are covered by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const refreshMs = opts.refreshMs;
  useEffect(() => {
    if (!refreshMs || key === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
