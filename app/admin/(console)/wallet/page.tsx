// /admin/wallet: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Wallet and ledger" };

export default function Page() {
  return (
    <ComingScreen title="Wallet and ledger" subtitle="Balances, escrow and every wallet transaction." icon="wallet">
      {"Summary cards, the transaction log with filters, escrows, and new adjustments."}
    </ComingScreen>
  );
}
