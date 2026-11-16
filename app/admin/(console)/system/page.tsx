// /admin/system: health checks, server facts and configuration (counts and flags only, no secrets).

import type { Metadata } from "next";
import { SystemScreen } from "./SystemScreen";

export const metadata: Metadata = { title: "System health" };

export default function Page() {
  return <SystemScreen />;
}
