// /admin/deposits: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Deposits" };

export default function Page() {
  return (
    <ComingScreen title="Deposits" subtitle="Deposits by status, the review queue first." icon="deposits">
      {"Deposits by status with approve and reject for the ones in review."}
    </ComingScreen>
  );
}
