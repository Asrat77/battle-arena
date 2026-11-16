// /admin/tournaments: every tournament with status, players, host and champion.

import type { Metadata } from "next";
import { Suspense } from "react";
import { TournamentsScreen } from "./TournamentsScreen";

export const metadata: Metadata = { title: "Tournaments" };

export default function Page() {
  // The screen keeps the status filter and page in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <TournamentsScreen />
    </Suspense>
  );
}
