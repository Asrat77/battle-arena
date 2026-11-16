// /admin/reconcile: replay the wallet log against the stored balances, and the platform fee report.

import type { Metadata } from "next";
import { ReconcileScreen } from "./ReconcileScreen";

export const metadata: Metadata = { title: "Reconcile and fees" };

export default function Page() {
  return <ReconcileScreen />;
}
