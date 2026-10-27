"use client";

// Runs engine/verify.ts in the browser: replays the log, recomputes the
// outcome and result hash, and checks them, the commitments and the whole
// chain against the ledger. Nothing here trusts the server's own verdict.

import { useState } from "react";
import { type VerifyReport, verifyMatch } from "@/engine/verify";
import { api, type StoredMatch } from "@/lib/api";

const LABELS: Record<string, string> = {
  game: "Game rules found",
  replay: "Log replays legally",
  outcome: "Replayed outcome matches the record",
  resultBlock: "Result block on the ledger",
  resultHash: "Result hash matches the block",
  commitments: "Commitments match the revealed secrets",
  reveal: "Revealed data matches the replay",
  chain: "Ledger chain is linked and signed",
};

export function VerifyPanel({ match }: { match: StoredMatch }) {
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      // Fetch the ledger fresh so the check uses the current chain.
      const ledger = await api.ledger();
      setReport(verifyMatch({ record: match.record, reveal: match.reveal, blocks: ledger.blocks, publicKey: ledger.publicKey }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-2" data-testid="verify">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 font-semibold">Verify</h2>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "Verifying…" : "Verify"}
        </button>
      </div>
      {match.status !== "recorded" && <p className="text-sm text-amber-600">The result block is still pending; verify may fail until it lands.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {report && (
        <>
          <p className={`font-semibold ${report.ok ? "text-green-700" : "text-red-600"}`}>
            {report.ok ? "Verified: this result is genuine." : "Verification failed."}
          </p>
          <ul className="space-y-1 text-sm">
            {report.checks.map((c) => (
              <li key={c.name} className="flex gap-2">
                <span className={c.ok ? "text-green-700" : "text-red-600"}>{c.ok ? "✓" : "✗"}</span>
                <span>
                  {LABELS[c.name] ?? c.name}
                  <span className="mono block text-gray-500">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
