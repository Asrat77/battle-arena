"use client";

// The simulated chain, newest first, with an in-browser integrity check.

import Link from "next/link";
import { useEffect, useState } from "react";
import { type ChainCheck, verifyChain } from "@/engine/ledger";
import { api, type LedgerResponse } from "@/lib/api";

function summary(kind: string, payload: unknown) {
  const p = payload as { matchId?: string; winner?: number | null };
  if ((kind === "commit" || kind === "result") && p?.matchId) {
    return (
      <>
        {kind === "result" ? `winner seat ${p.winner ?? "none (draw)"} · ` : "secret commitments · "}
        <Link className="underline" href={`/replay/${p.matchId}`}>
          match {p.matchId.slice(0, 8)}
        </Link>
      </>
    );
  }
  return <span className="mono">{JSON.stringify(payload)}</span>;
}

export default function LedgerPage() {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [check, setCheck] = useState<ChainCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.ledger().then(setLedger, (e) => setError(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!ledger) return <p className="text-sm text-gray-500">Loading ledger…</p>;

  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <h1 className="font-semibold">Ledger</h1>
        <p className="text-sm text-gray-600">
          A simulated chain: every block links to the previous block&apos;s hash and is signed by the server key.{" "}
          {ledger.blocks.length} blocks{ledger.pending ? `, ${ledger.pending} pending` : ""}.
        </p>
        <p className="mono text-gray-500">server key {ledger.publicKey}</p>
        <div className="flex items-center gap-3">
          <button className="btn" onClick={() => setCheck(verifyChain(ledger.blocks, ledger.publicKey))}>
            Check chain
          </button>
          {check &&
            (check.ok ? (
              <span className="text-sm text-green-700">✓ All {ledger.blocks.length} blocks linked and signed</span>
            ) : (
              <span className="text-sm text-red-600">
                ✗ Block {check.index}: {check.reason}
              </span>
            ))}
        </div>
      </section>
      <ul className="space-y-2">
        {[...ledger.blocks].reverse().map((b) => (
          <li key={b.index} id={`block-${b.index}`} className="card text-sm target:border-gray-900">
            <p>
              <span className="font-semibold">#{b.index}</span> <span className="uppercase text-gray-500">{b.kind}</span>{" "}
              <span className="text-xs text-gray-500">{new Date(b.ts).toLocaleString()}</span>
            </p>
            <p>{summary(b.kind, b.payload)}</p>
            <p className="mono text-gray-500">hash {b.hash}</p>
            <p className="mono text-gray-400">prev {b.prevHash}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
