// /admin/activity: the merged live feed (sign-ups, matches, money, tournaments, admin) with type chips.

import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityScreen } from "./ActivityScreen";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  // The screen keeps the type filter in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <ActivityScreen />
    </Suspense>
  );
}
