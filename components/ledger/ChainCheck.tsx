"use client";

// "Check chain": runs verifyChain over every block in the browser, then walks
// the chain one link at a time so the check is visible, and ends on a verdict.
// The walk takes about two seconds however long the chain is; with reduced
// motion it jumps straight to the verdict.

import { useEffect, useRef, useState } from "react";
import { type Block, type ChainCheck as Check, verifyChain } from "@/engine/ledger";
import { Button } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";

const WALK_MS = 1800;
const TICK_MS = 40;

// verifyChain's reasons in words a judge can read.
function explain(check: Extract<Check, { ok: false }>) {
  const i = check.index;
  switch (check.reason) {
    case "prevHash does not match previous block":
      return i === 0 ? "It doesn’t start from the genesis hash." : `Its previous-hash doesn’t match block #${i - 1}.`;
    case "hash does not match contents":
      return "Its contents were changed after it was sealed.";
    case "bad signature":
      return "It isn’t signed by the server key.";
    case "index out of sequence":
      return "A block is missing or out of order here.";
    default:
      return check.reason;
  }
}

export function ChainCheck({
  blocks,
  publicKey,
  onResult,
  onOpen,
}: {
  blocks: Block[];
  publicKey: string;
  /** The finished verdict, or null while a walk is running. */
  onResult: (check: Check | null) => void;
  onOpen: (index: number) => void;
}) {
  const [run, setRun] = useState<{ check: Check; total: number } | null>(null);
  const [step, setStep] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  const end = run ? (run.check.ok ? run.total : run.check.index + 1) : 0;
  const done = run !== null && step >= end;

  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    if (done) onResult(run.check);
  }, [done, run, onResult]);

  const start = () => {
    clearInterval(timer.current);
    const check = verifyChain(blocks, publicKey);
    const total = blocks.length;
    const last = check.ok ? total : check.index + 1;
    setRun({ check, total });
    onResult(null);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(last);
      return;
    }
    setStep(0);
    const per = Math.max(1, Math.ceil((total * TICK_MS) / WALK_MS));
    timer.current = setInterval(() => {
      setStep((s) => {
        const next = Math.min(last, s + per);
        if (next >= last) clearInterval(timer.current);
        return next;
      });
    }, TICK_MS);
  };

  const broken = run && !run.check.ok ? run.check : null;

  return (
    <section aria-label="Chain check" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="verified" onClick={start} loading={run !== null && !done} disabled={blocks.length === 0}>
          {run ? "Check again" : "Check chain"}
        </Button>
      </div>

      {run && (
        <div className="card flex flex-col gap-3 !p-3.5">
          <ol className="flex flex-wrap gap-[3px]" aria-hidden>
            {Array.from({ length: run.total }, (_, i) => {
              const tone = i >= step ? "bg-sf-3" : broken && i === broken.index ? "bg-mismatch" : "bg-recorded";
              return <li key={i} className={`h-2.5 w-2.5 rounded-[3px] transition-colors ${tone}`} />;
            })}
          </ol>

          <div role="status" aria-live="polite">
            {!done ? (
              <p className="text-small text-ink-2">
                Checking link {Math.min(step + 1, run.total)} of {run.total}…
              </p>
            ) : broken ? (
              <div className="flex items-start gap-3">
                <Icon3D name="unverified" size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-mismatch">Chain broken at block #{broken.index}</p>
                  <p className="text-small text-ink-2">
                    {explain(broken)}{" "}
                    {broken.index > 0
                      ? `Records after #${broken.index - 1} can’t be verified until this is fixed.`
                      : "No record can be verified until this is fixed."}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpen(broken.index)}
                    className="mt-1 text-small font-semibold text-you underline underline-offset-2"
                  >
                    Open block #{broken.index}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Icon3D name="verified" size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-recorded">Chain intact · {run.total} blocks</p>
                  <p className="text-small text-ink-2">Every link, hash and server signature checks out.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
