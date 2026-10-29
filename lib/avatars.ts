"use client";

// Picked avatars by profile id. Avatar3D only has an id to go on, so it asks
// this cache, which fetches each profile once and shares the answer.

import { useEffect, useSyncExternalStore } from "react";
import { isAvatar, type AvatarName } from "@/engine/avatars";
import { api, BOT_PLAYER } from "./api";

// undefined = not fetched yet, null = fetched with no pick (use the default)
const picked = new Map<string, AvatarName | null>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Record what the server told us about a profile (also used after you change yours). */
export function rememberAvatar(id: string, avatar: string | undefined) {
  const next = isAvatar(avatar) ? avatar : null;
  if (picked.get(id) === next) return;
  picked.set(id, next);
  emit();
}

function load(id: string) {
  if (picked.has(id) || inflight.has(id)) return;
  inflight.add(id);
  api
    .profile(id)
    .then((p) => rememberAvatar(id, p.avatar), () => rememberAvatar(id, undefined))
    .finally(() => inflight.delete(id));
}

/** The picked avatar for an id: undefined while loading, null for "use the default". */
export function usePickedAvatar(id: string, skip = false): AvatarName | null | undefined {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => picked.get(id),
    () => undefined,
  );
  const lookup = !skip && id !== BOT_PLAYER;
  useEffect(() => {
    if (lookup) load(id);
  }, [id, lookup]);
  return lookup ? value : null;
}
