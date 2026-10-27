"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { shortId } from "@/lib/usePlayerNames";

export function Header() {
  const { profile, connected, signOut } = useSession();
  return (
    <header className="border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-bold">
          Battle Arena
        </Link>
        <Link href="/ledger" className="text-gray-600 hover:text-gray-900">
          Ledger
        </Link>
        {profile && (
          <span className="ml-auto flex items-center gap-3">
            <span title={connected ? "connected" : "offline"} className={connected ? "text-green-600" : "text-gray-400"}>
              ●
            </span>
            <span>
              {profile.name} <span className="mono text-gray-500">{shortId(profile.id)}</span>
            </span>
            <button className="text-gray-500 hover:text-gray-900" onClick={signOut}>
              Sign out
            </button>
          </span>
        )}
      </nav>
    </header>
  );
}
