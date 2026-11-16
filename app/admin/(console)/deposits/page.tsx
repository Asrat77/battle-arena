// /admin/deposits: tabs by status, the review queue, and approve / reject with a written reason.

import type { Metadata } from "next";
import { Suspense } from "react";
import { DepositsScreen } from "./DepositsScreen";

export const metadata: Metadata = { title: "Deposits" };

export default function Page() {
  // Tab, search, page and the open deposit live in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <DepositsScreen />
    </Suspense>
  );
}
