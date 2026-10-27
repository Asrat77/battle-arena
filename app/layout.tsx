import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Battle Arena",
  description: "Live 1v1 games with verifiable results",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <SessionProvider>
          <Header />
          <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
