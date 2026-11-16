// Root of the admin site: the dark .admin scope, its own title and theme
// colour, and noindex. Rendered dynamically so no admin page is ever served
// from a static cache (middleware.ts adds the security headers).

import type { Metadata, Viewport } from "next";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin · Battle Arena", template: "%s · Admin · Battle Arena" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#0C0A09",
  colorScheme: "dark",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin">{children}</div>;
}
