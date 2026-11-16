// /admin/audit: placeholder until its task builds the screen.

import type { Metadata } from "next";
import { ComingScreen } from "@/components/admin/ComingScreen";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return (
    <ComingScreen title="Audit log" subtitle="Who did what as admin, and why." icon="audit">
      {"Every admin sign-in, adjustment and deposit decision, with reasons."}
    </ComingScreen>
  );
}
