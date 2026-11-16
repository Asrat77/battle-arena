// Every signed-in admin screen (everything under /admin except the login
// page) sits inside the console shell, which checks the session on load.

import { AdminShell } from "@/components/admin/AdminShell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
