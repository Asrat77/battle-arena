"use client";

// A PlayerCell for when only the id is known (reconcile mismatches, the legacy
// report): looks the player up with GET users?q=<id> (ids match by prefix).

import { useEffect, useState } from "react";
import { adminGet } from "@/lib/admin/api";
import { shortId } from "@/lib/admin/format";
import type { Page, UserRow } from "@/lib/admin/types";
import { PlayerCell } from "./PlayerCell";

export function PlayerById({ id, size = "md" }: { id: string; size?: "sm" | "md" }) {
  const [user, setUser] = useState<UserRow | null>(null);
  useEffect(() => {
    setUser(null);
    if (!id || id === "platform") return;
    const ctrl = new AbortController();
    adminGet<Page<UserRow>>("users", { q: id, limit: 5 }, ctrl.signal).then(
      (r) => !ctrl.signal.aborted && setUser(r.rows.find((u) => u.id === id) ?? null),
      () => undefined,
    );
    return () => ctrl.abort();
  }, [id]);
  return <PlayerCell id={id} name={user?.name ?? shortId(id, 8, 4)} username={user?.username} avatar={user?.avatar} size={size} />;
}
