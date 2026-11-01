"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export const cleanUsername = (u: string) => u.trim().replace(/^@/, "").toLowerCase();

/** Live "is this handle free?" check, debounced while typing. */
export function useUsernameCheck(raw: string, current = "") {
  const [state, setState] = useState<{ for: string; free: boolean; reason?: string } | null>(null);
  const username = cleanUsername(raw);
  const valid = USERNAME_RE.test(username);
  useEffect(() => {
    if (!valid || username === current) return;
    let live = true;
    const t = setTimeout(() => {
      api.usernameStatus(username).then(
        (s) => live && setState({ for: username, free: s.available, reason: s.reason }),
        () => live && setState(null),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [username, valid, current]);

  if (!username || username === current) return { username, ok: true, note: null };
  if (!valid) return { username, ok: false, note: "3–20 letters, numbers or underscores" };
  if (state?.for !== username) return { username, ok: false, note: "Checking…" };
  return state.free ? { username, ok: true, note: `@${username} is free` } : { username, ok: false, note: "That username is taken" };
}
