// /admin/players/[id]: one player's profile, balances, matches, wallet, deposits and withdrawals.

import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayerScreen } from "./PlayerScreen";

export const metadata: Metadata = { title: "Player" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The screen keeps the tab in ?tab= (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <PlayerScreen id={decodeURIComponent(id)} />
    </Suspense>
  );
}
