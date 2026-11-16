// /admin/players: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Players" };

export default function Page() {
  return (
    <ComingScreen title="Players" subtitle="Everyone who has played, with balances and activity." icon="players">
      {"Search, filters, a sortable player table and CSV export."}
    </ComingScreen>
  );
}
