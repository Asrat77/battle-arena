// /admin/withdrawals: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Withdrawals" };

export default function Page() {
  return (
    <ComingScreen title="Withdrawals" subtitle="Withdrawals by status. Payouts are handled in Telegram." icon="withdrawals">
      {"Withdrawals by status, read-only, with moderator notes."}
    </ComingScreen>
  );
}
