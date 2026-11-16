// /admin/kit: the admin UI kit (dev aid, behind the same sign-in as the rest).

import type { Metadata } from "next";
import { KitScreen } from "./KitScreen";

export const metadata: Metadata = { title: "UI kit" };

export default function Page() {
  return <KitScreen />;
}
