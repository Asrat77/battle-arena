// /admin/players/[id]: placeholder until the players task builds the detail screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Player" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ComingScreen title="Player" subtitle={`Player id ${decodeURIComponent(id)}`} icon="players">
      {"Profile, balances, matches, wallet, deposits and withdrawals for one player, with Adjust balance."}
    </ComingScreen>
  );
}
