// /admin: the overview screen.

import type { Metadata } from "next";
import { Suspense } from "react";
import { OverviewScreen } from "./OverviewScreen";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  // The screen reads ?metric= and ?q= (useSearchParams needs a Suspense boundary).
  return (
    <Suspense fallback={null}>
      <OverviewScreen />
    </Suspense>
  );
}
