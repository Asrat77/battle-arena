import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Battle Arena",
  description: "Live 1v1 games with verifiable results",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
