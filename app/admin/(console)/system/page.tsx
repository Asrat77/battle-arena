// /admin/system: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "System health" };

export default function Page() {
  return (
    <ComingScreen title="System health" subtitle="Store, ledger, wallet log and configuration." icon="system">
      {"Health cards and configuration, with no secrets."}
    </ComingScreen>
  );
}
