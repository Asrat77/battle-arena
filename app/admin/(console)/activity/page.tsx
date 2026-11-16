// /admin/activity: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return (
    <ComingScreen title="Activity" subtitle="Everything that happens, newest first." icon="activity">
      {"A live feed of sign-ups, matches, deposits, withdrawals, adjustments, tournaments and admin actions, with type filters."}
    </ComingScreen>
  );
}
