// /admin/withdrawals: read only (payouts happen in Telegram): summary, tabs by status, the list and a drawer.

import type { Metadata } from "next";
import { Suspense } from "react";
import { WithdrawalsScreen } from "./WithdrawalsScreen";

export const metadata: Metadata = { title: "Withdrawals" };

export default function Page() {
  // Tab, search, page and the open withdrawal live in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <WithdrawalsScreen />
    </Suspense>
  );
}
