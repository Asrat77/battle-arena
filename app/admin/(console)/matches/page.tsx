// /admin/matches: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Matches" };

export default function Page() {
  return (
    <ComingScreen title="Matches" subtitle="Live and recorded matches." icon="matches">
      {"Live matches now, recorded matches with filters, and a detail panel with the replay link."}
    </ComingScreen>
  );
}
