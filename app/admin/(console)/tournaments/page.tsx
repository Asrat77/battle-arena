// /admin/tournaments: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Tournaments" };

export default function Page() {
  return (
    <ComingScreen title="Tournaments" subtitle="Brackets, players and champions." icon="tournaments">
      {"Every tournament with its status, game, size, players and champion."}
    </ComingScreen>
  );
}
