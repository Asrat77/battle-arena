"use client";

// One block opened from the ledger list: its summary, full hash, a link to the
// block it points back to, the signature and the raw payload. Hashes are only
// shown in full here; the list keeps them short.

import type { Block } from "@/engine/ledger";
import { verifyBlockSig } from "@/engine/ledger";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";
import { Sheet } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { blockMatchId, KINDS } from "./BlockRow";

function stamp(ts: number) {
  return new Date(ts).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function BlockSheet({
  block,
  summary,
  publicKey,
  onClose,
  onOpen,
}: {
  block: Block | null;
  summary: string;
  publicKey: string;
  onClose: () => void;
  /** Opens another block in the sheet (the previous-hash link). */
  onOpen: (index: number) => void;
}) {
  const toast = useToast();
  if (!block) return null;

  const look = KINDS.find((k) => k.kind === block.kind);
  const matchId = blockMatchId(block);
  const signed = verifyBlockSig(block, publicKey);
  const genesis = block.index === 0;

  const copyLink = async () => {
    const url = `${window.location.origin}/ledger#block-${block.index}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ icon: "link", body: `Copied the link to block #${block.index}` });
    } catch {
      toast.show({ icon: "warning", tone: "warn", body: `Couldn’t copy. The link is /ledger#block-${block.index}` });
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`#${block.index} · ${look?.label ?? block.kind} block`}
      hero={
        <div className="dither flex items-center gap-3 px-[18px] py-3">
          <Icon3D name={look?.icon ?? "blockchain"} size={48} />
          <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">{summary}</p>
        </div>
      }
    >
      <dl className="flex flex-col gap-2.5">
        <Detail label="Time">
          <time className="mono text-small" dateTime={new Date(block.ts).toISOString()}>
            {stamp(block.ts)}
          </time>
        </Detail>
        <Detail label="Hash">
          <p className="mono break-all text-[12px]">{block.hash}</p>
        </Detail>
        <Detail label="Prev hash">
          {genesis ? (
            <p className="mono break-all text-[12px] text-ink-3">{block.prevHash} · genesis</p>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(block.index - 1)}
              className="mono break-all text-left text-[12px] text-you underline decoration-you/40 underline-offset-2"
              aria-label={`Previous hash ${block.prevHash}, open block ${block.index - 1}`}
            >
              {block.prevHash} <span className="whitespace-nowrap font-sans font-semibold">→ #{block.index - 1}</span>
            </button>
          )}
        </Detail>
        <Detail label="Signature">
          <p className="mono break-all text-[12px]">{block.sig}</p>
          <p className="mt-1.5">
            {signed ? (
              <Chip tone="rec" icon="verified">
                Signed by server key
              </Chip>
            ) : (
              <Chip tone="bad" icon="unverified">
                Signature doesn’t match the server key
              </Chip>
            )}
          </p>
        </Detail>
        <Detail label="Payload">
          <pre className="mono max-h-[240px] overflow-auto rounded-2xl bg-sf-2 p-3 text-[12px] leading-relaxed">
            {JSON.stringify({ kind: block.kind, ...(block.payload as object) }, null, 2)}
          </pre>
        </Detail>
      </dl>

      <div className="flex flex-wrap gap-2 [&>*]:flex-1">
        {matchId && (
          <ButtonLink href={`/replay/${matchId}`} variant="act" icon="verified">
            Replay &amp; verify
          </ButtonLink>
        )}
        <Button icon="link" onClick={copyLink}>
          Copy block link
        </Button>
      </div>
    </Sheet>
  );
}
