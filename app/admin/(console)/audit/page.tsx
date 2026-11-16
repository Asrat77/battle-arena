// /admin/audit: who did what as admin, with reasons; filters, search and CSV.

import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditScreen } from "./AuditScreen";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  // Filter, search, page and the open entry live in the URL (useSearchParams needs Suspense).
  return (
    <Suspense fallback={null}>
      <AuditScreen />
    </Suspense>
  );
}
