// /admin/players: search, filters, sortable table and CSV export.

import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayersScreen } from "./PlayersScreen";

export const metadata: Metadata = { title: "Players" };

export default function Page() {
  // The screen keeps q, filter, sort, dir and page in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <PlayersScreen />
    </Suspense>
  );
}
