"use client";

// The ledger explorer: every block newest first, filterable by kind and
// searchable by match ID, block number or hash. /ledger#block-N scrolls to
// that block and tints it for 2 s.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BlockRow, blockMatchId, blockPlayers, commitIndex, KINDS, summarize } from "@/components/ledger/BlockRow";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon3D } from "@/components/ui/Icon3D";
import { type BlockKind, type ChainCheck, verifyChain } from "@/engine/ledger";
import { api, type LedgerResponse } from "@/lib/api";
import { shortId, usePlayerNames } from "@/lib/usePlayerNames";

const POLL_MS = 3000;
const FLASH_MS = 2000;

function anchoredBlock(): number | null {
  const m = /^#block-(\d+)$/.exec(window.location.hash);
  return m ? Number(m[1]) : null;
}

export default function LedgerPage() {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<BlockKind | "all">("all");
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [check, setCheck] = useState<ChainCheck | null>(null);

  const load = useCallback(
    () =>
      api.ledger().then(
        (l) => {
          setLedger(l);
          setFailed(false);
        },
        () => setFailed(true),
      ),
    [],
  );

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Follow #block-N on arrival and whenever the hash changes; clear filters so
  // the target row is on screen.
  useEffect(() => {
    const follow = () => {
      const n = anchoredBlock();
      if (n === null) return;
      setKind("all");
      setQuery("");
      setFlash(n);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const hasFlashRow = flash !== null && Boolean(ledger?.blocks[flash]);
  useEffect(() => {
    if (!hasFlashRow) return;
    document.getElementById(`block-${flash}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash, hasFlashRow]);

  const blocks = useMemo(() => ledger?.blocks ?? [], [ledger]);
  const commits = useMemo(() => commitIndex(blocks), [blocks]);
  const ids = useMemo(() => [...new Set(blocks.flatMap((b) => blockPlayers(b, commits)))].sort(), [blocks, commits]);
  const names = usePlayerNames(ids.length ? ids : undefined);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const byKind = kind === "all" ? blocks : blocks.filter((b) => b.kind === kind);
    if (!q) return [...byKind].reverse();
    const num = /^#?(\d+)$/.exec(q);
    return byKind
      .filter(
        (b) =>
          (num && b.index === Number(num[1])) ||
          blockMatchId(b)?.toLowerCase().includes(q) ||
          b.hash.startsWith(q.replace(/^0x/, "")),
      )
      .reverse();
  }, [blocks, kind, q]);

  if (!ledger)
    return failed ? (
      <EmptyState
        icon="satellite"
        title="Couldn’t load the ledger"
        action={
          <Button icon="refresh" onClick={load}>
            Try again
          </Button>
        }
      >
        Nothing is wrong with the records; we just couldn’t fetch them.
      </EmptyState>
    ) : (
      <div className="flex flex-col gap-2" aria-busy>
        <div className="h-[60px] animate-pulse rounded-card bg-sf" />
        <div className="h-[60px] animate-pulse rounded-card bg-sf opacity-70" />
      </div>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3.5">
      <header className="flex items-center gap-3">
        <Icon3D name="blockchain" size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-.04em]">Ledger</h1>
          <p className="text-small text-ink-2">Every result, badge and token, in order</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {ledger.pending > 0 ? (
            <Chip tone="pend" spin>
              {ledger.pending} pending
            </Chip>
          ) : (
            <Chip>All sealed</Chip>
          )}
          <span className="mono text-[11px] text-ink-3">{blocks.length} blocks</span>
        </div>
      </header>

      {failed && (
        <p role="status" className="flex items-center gap-2 text-small text-ink-2">
          <Icon3D name="satellite" size={22} /> Can’t reach the server. Showing the last blocks we loaded.
        </p>
      )}

      {/* Interim chain check; L2 replaces it with the walking ChainCheck. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="verified" onClick={() => setCheck(verifyChain(blocks, ledger.publicKey))}>
          Check chain
        </Button>
        {check &&
          (check.ok ? (
            <Chip tone="rec" icon="check">
              Chain intact · {blocks.length} blocks
            </Chip>
          ) : (
            <Chip tone="bad" icon="unverified">
              Broken at #{check.index}: {check.reason}
            </Chip>
          ))}
      </div>

      {blocks.length === 0 ? (
        <EmptyState
          icon="vault"
          title="No blocks yet"
          action={
            <ButtonLink href="/" variant="act" icon="controller">
              Play a match
            </ButtonLink>
          }
        >
          Every finished match adds a block here. Play one and watch it appear.
        </EmptyState>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              className={`input !h-[46px] !text-[15px] ${q ? "font-mono" : ""}`}
              type="text"
              inputMode="search"
              placeholder="Match ID, block # or hash"
              aria-label="Search the ledger"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <IconButton icon="xmark" label="Clear search" className="!h-[46px] !w-[46px]" onClick={() => setQuery("")} />}
          </div>

          <div role="radiogroup" aria-label="Block kind" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
            {[{ kind: "all" as const, label: "All", icon: undefined }, ...KINDS].map((k) => {
              const on = kind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(k.kind)}
                  className={`chip !h-9 !px-3.5 !text-[13px] ${on ? "!bg-ink !text-bg" : ""}`}
                >
                  {k.icon && <Icon3D name={k.icon} size={18} />}
                  {k.label}
                </button>
              );
            })}
          </div>

          {q && shown.length > 0 && (
            <p className="text-small text-ink-2" role="status">
              {shown.length} block{shown.length === 1 ? "" : "s"} for <span className="mono">{q.length > 14 ? shortId(q) : q}</span>
            </p>
          )}

          {shown.length === 0 ? (
            <div role="status" className="flex items-center gap-2.5 rounded-[18px] bg-sf p-3.5">
              <Icon3D name="magnifier" size={32} />
              <span className="text-small">
                <b className="font-semibold">
                  No {kind === "all" ? "" : `${kind} `}blocks{q ? <> for <span className="mono">{query.trim()}</span></> : ""}.
                </b>{" "}
                <span className="text-ink-2">Try a full match ID, a block number like #12, or the start of a hash.</span>
              </span>
            </div>
          ) : (
            <ul className="card !py-1">
              {shown.map((b) => (
                <BlockRow key={b.index} block={b} summary={summarize(b, commits, names)} highlight={b.index === flash} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
