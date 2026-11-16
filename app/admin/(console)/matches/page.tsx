// /admin/matches: live matches, the recorded matches table with filters, and the match drawer.

import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchesScreen } from "./MatchesScreen";

export const metadata: Metadata = { title: "Matches" };

export default function Page() {
  // The screen keeps game, type, stake, player, page and open in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <MatchesScreen />
    </Suspense>
  );
}
