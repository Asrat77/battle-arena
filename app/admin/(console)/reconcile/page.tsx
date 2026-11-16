// /admin/reconcile: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Reconcile and fees" };

export default function Page() {
  return (
    <ComingScreen title="Reconcile and fees" subtitle="Check the books and the platform fees." icon="reconcile">
      {"Run reconcile on both books and see the fee report."}
    </ComingScreen>
  );
}
