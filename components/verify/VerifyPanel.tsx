"use client";

// Runs engine/verify.ts in the browser: replays the log, recomputes the
// outcome and result hash, and checks them, the commitments and the whole
// chain against the ledger. Nothing here trusts the server's own verdict.
// The report is ready almost at once; the rows are revealed one about every
// 450 ms so a person can follow what is being checked.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { useToast } from "@/components/ui/Toast";
import { type Check, type VerifyReport, verifyMatch } from "@/engine/verify";
import { api, type StoredMatch } from "@/lib/api";
import { shortId } from "@/lib/usePlayerNames";
import { CHECK_TITLES, failureSentence, shortHashes } from "./checks";

const STEP_MS = 450;
const POLL_MS = 2000;

type Run = { report: VerifyReport; ms: number };

export function VerifyPanel({
  match: initialMatch,
  names,
  onDone,
}: {
  match: StoredMatch;
  /** Display names by seat, for the outcome line. */
  names?: [string, string];
  onDone?(report: VerifyReport): void;
}) {
  const [match, setMatch] = useState(initialMatch);
  const [run, setRun] = useState<Run | null>(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const matchId = match.record.matchId;
  useEffect(() => setMatch(initialMatch), [initialMatch]);

  // Verify needs the result block, so poll until the record lands.
  useEffect(() => {
    if (match.status === "recorded") return;
    const t = setInterval(() => {
      api.match(matchId).then((m) => m.status === "recorded" && setMatch(m), () => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [match.status, matchId]);

  const total = run?.report.checks.length ?? 0;
  const finished = run !== null && shown >= total;

  useEffect(() => {
    if (!run || shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [run, shown, total]);

  useEffect(() => {
    if (finished && run) doneRef.current?.(run.report);
  }, [finished, run]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setRun(null);
    setShown(0);
    try {
      // Fetch the ledger fresh so the check uses the current chain.
      const ledger = await api.ledger();
      const t0 = performance.now();
      const report = verifyMatch({ record: match.record, reveal: match.reveal, blocks: ledger.blocks, publicKey: ledger.publicKey });
      setRun({ report, ms: performance.now() - t0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(matchId);
      toast.show({ icon: "link", body: "Match ID copied", href: links.result === null ? "/ledger" : `/ledger#block-${links.result}`, duration: 2500 });
    } catch {
      toast.show({ icon: "warning", body: `Copy failed. Match ID: ${matchId}`, tone: "warn" });
    }
  };

  const links = { result: match.resultIndex, commit: match.commitIndex };

  if (!run) {
    if (match.status !== "recorded")
      return (
        <section className="card flex flex-col gap-3" data-testid="verify">
          <div className="flex items-center gap-3">
            <Icon3D name="hourglass" size={44} />
            <div className="min-w-0 flex-1">
              <b className="font-semibold">Recording on the ledger…</b>
              <p className="text-small text-ink-3">Replay works now. Verify unlocks when the record lands, usually within seconds.</p>
            </div>
          </div>
          <Button variant="act" icon="verified" block disabled>
            Waiting for the ledger
          </Button>
        </section>
      );
    return (
      <section className="flex flex-col gap-2" data-testid="verify">
        <Button variant="act" icon="verified" block loading={busy} onClick={start}>
          Verify this result
        </Button>
        {error ? (
          <p className="text-center text-small text-mismatch" role="alert">
            Couldn’t load the ledger: {error}
          </p>
        ) : (
          <p className="text-center text-small text-ink-3">Runs in your browser. Nothing is sent anywhere.</p>
        )}
      </section>
    );
  }

  const { report, ms } = run;
  return (
    <section className="flex flex-col gap-3" data-testid="verify" aria-busy={!finished}>
      {finished ? (
        <Verdict report={report} ms={ms} />
      ) : (
        <>
          <div className="flex items-center gap-3.5 py-1">
            <div className="plate flex h-[72px] w-[72px] flex-none items-center justify-center rounded-[22px]">
              <Icon3D name="magnifier" size={52} />
            </div>
            <div className="min-w-0 flex-1">
              <b className="text-[22px] font-semibold tracking-[-.03em]">Verifying…</b>
              <div className="mono text-small text-ink-3">
                Match {shortId(matchId)}
                {links.result !== null && ` · block #${links.result}`}
              </div>
            </div>
            <span className="mono text-[20px] font-semibold">
              {shown}/{total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sf-3" aria-hidden>
            <i className="block h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${(shown / total) * 100}%` }} />
          </div>
        </>
      )}

      <ol className="card px-3.5 py-1.5">
        {report.checks.map((c, i) => (
          <CheckRow key={c.name} n={i + 1} check={c} state={i < shown ? "done" : i === shown ? "running" : "waiting"} names={names} links={links} />
        ))}
      </ol>

      {finished &&
        (report.ok ? (
          <>
            <div className="card">
              <b className="text-small font-semibold">What does this prove?</b>
              <p className="mt-1.5 text-small text-ink-3">
                The moves replay to the same winner, the record hasn’t changed since it was written, and any secrets were fixed before play began. It makes
                any later edit visible. It can’t prove who was holding the device.
              </p>
            </div>
            <Button icon="refresh" block onClick={start} loading={busy}>
              Run the checks again
            </Button>
          </>
        ) : (
          <>
            <p className="text-small text-ink-3">
              Something changed this record after it was written, or the copy you loaded is different. Report it with the match ID.
            </p>
            <div className="flex gap-2">
              <Button icon="link" className="flex-1" onClick={copyId}>
                Copy match ID
              </Button>
              <Button variant="ghost" onClick={start} loading={busy}>
                Run again
              </Button>
            </div>
          </>
        ))}
    </section>
  );
}

function Verdict({ report, ms }: { report: VerifyReport; ms: number }) {
  const ok = report.ok;
  return (
    <div
      role="status"
      className={`flex animate-pop items-center gap-4 rounded-game p-4 md:p-5 ${
        ok ? "bg-recorded-soft shadow-[inset_0_0_0_1px_rgb(var(--rec)/.4)]" : "bg-mismatch-soft shadow-[inset_0_0_0_1px_rgb(var(--bad)/.4)]"
      }`}
    >
      <Icon3D name={ok ? "verified" : "unverified"} size={64} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <b className={`text-[22px] font-semibold tracking-[-.03em] md:text-[26px] ${ok ? "text-recorded" : "text-mismatch"}`}>{ok ? "Verified" : "Mismatch"}</b>
        <span className={ok ? "" : "text-small"}>{ok ? "This result matches the ledger." : failureSentence(report.checks)}</span>
        <span className="text-small text-ink-3">
          {report.checks.length} checks ran in your browser · {ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`}
        </span>
      </div>
    </div>
  );
}

function CheckRow({
  n,
  check,
  state,
  names,
  links,
}: {
  n: number;
  check: Check;
  state: "done" | "running" | "waiting";
  names?: [string, string];
  links: { result: number | null; commit: number | null };
}) {
  const title = `${n}. ${CHECK_TITLES[check.name]}`;
  const block = check.name === "resultBlock" || check.name === "resultHash" ? links.result : check.name === "commitments" ? links.commit : null;
  const fail = state === "done" && !check.ok;

  let detail = shortHashes(check.detail);
  if (check.name === "outcome" && check.ok && names) {
    const m = /^seat (\d) wins/.exec(check.detail);
    if (m) detail = `Replayed winner ${names[Number(m[1])]} = recorded winner`;
  }
  if (check.ok && check.name === "resultBlock") detail = `Found in block #${block}`;
  if (check.ok && check.name === "commitments" && block !== null) detail = `Published in block #${block}, before play`;

  return (
    <li className={`flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 ${state === "waiting" ? "opacity-50" : ""}`}>
      <span className="flex h-[26px] w-[26px] flex-none items-center justify-center">
        {state === "done" ? (
          <Icon3D name={check.ok ? "check" : "xmark"} size={26} label={check.ok ? "Passed" : "Failed"} className="animate-pop" />
        ) : state === "running" ? (
          <span className="spin text-pending" aria-label="Checking" />
        ) : (
          <i className="block h-2 w-2 rounded-full bg-sf-3" aria-label="Waiting" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <b className={`text-small font-semibold ${fail ? "text-mismatch" : ""}`}>{title}</b>
        <span className="text-small text-ink-3 [overflow-wrap:anywhere]">{state === "done" ? detail : state === "running" ? "Checking…" : "Waiting"}</span>
      </div>
      {state === "done" && block !== null && (
        <Link href={`/ledger#block-${block}`} className="chip flex-none" aria-label={`Open block ${block} on the ledger`}>
          <Icon3D name="blockchain" size={16} />#{block}
        </Link>
      )}
    </li>
  );
}
