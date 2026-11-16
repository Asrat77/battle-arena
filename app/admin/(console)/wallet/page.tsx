// /admin/wallet: totals, the liabilities check, the ledger (transactions, escrows,
// adjustments) and the adjustment dialog (also opened by ?adjust=<id|platform>).

import type { Metadata } from "next";
import { Suspense } from "react";
import { WalletScreen } from "./WalletScreen";

export const metadata: Metadata = { title: "Wallet and ledger" };

export default function Page() {
  // Tabs, filters, page and ?adjust live in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <WalletScreen />
    </Suspense>
  );
}
