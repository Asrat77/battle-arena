"use client";

import { useEffect, useState } from "react";
import { api, BOT_PLAYER } from "./api";

const cache = new Map<string, string>();

/** Display names for profile ids; the bot and unknown ids get a fallback. */
export function usePlayerNames(ids: readonly string[] | undefined): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = ids?.join(",") ?? "";

  useEffect(() => {
    if (!key) return;
    let live = true;
    const list = key.split(",");
    Promise.all(
      list.map(async (id) => {
        if (id === BOT_PLAYER) return [id, "Bot"] as const;
        if (!cache.has(id)) {
          const name = await api.profile(id).then((p) => p.name, () => shortId(id));
          cache.set(id, name);
        }
        return [id, cache.get(id)!] as const;
      }),
    ).then((pairs) => live && setNames(Object.fromEntries(pairs)));
    return () => {
      live = false;
    };
  }, [key]);

  return names;
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
