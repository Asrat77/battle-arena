"use client";

// One player: header card (avatar, name, @username, status, ids, dates and the
// actions), a live-match banner, the balance cards and five tabs kept in ?tab=.
// A 404 from the API shows "Player not found" with a way back to the list.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdjustBalanceButton } from "@/components/admin/AdjustBalanceButton";
import { ButtonLink, Button } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { CopyButton } from "@/components/admin/CopyButton";
import { EmptyState } from "@/components/admin/EmptyState";
import { Icon } from "@/components/admin/icons";
import { Money } from "@/components/admin/Money";
import { AdminAvatar } from "@/components/admin/PlayerCell";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill } from "@/components/admin/StatusPill";
import { Tabs } from "@/components/admin/Tabs";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { useAdminCrumb } from "@/components/admin/AdminContext";
import { useAdminQuery } from "@/lib/admin/api";
import { dateShort, dateTime, num, shortId, type Book } from "@/lib/admin/format";
import { TABS, parseTab, type PlayerTab } from "@/lib/admin/players";
import { useAdminPrefs } from "@/lib/admin/prefs";
import type { UserDetail } from "@/lib/admin/types";
import { DepositsPanel, MatchesPanel, OverviewPanel, WalletPanel, WithdrawalsPanel } from "./PlayerPanels";

const TAB_LABELS: Record<PlayerTab, string> = { overview: "Overview", matches: "Matches", wallet: "Wallet", deposits: "Deposits", withdrawals: "Withdrawals" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label !text-[10.5px]">{label}</dt>
      <dd className="mt-1 truncate text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

function PlayerHeader({ d }: { d: UserDetail }) {
  const p = d.profile;
  const registered = d.account.hasPassword;
  return (
    <Card as="section" className="mb-4 lg:mb-5" bodyClassName="p-4 lg:p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <AdminAvatar id={p.id} avatar={p.avatar} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink lg:text-[24px]">{p.name}</h1>
            <p className="mt-0.5 truncate font-mono text-[13px] text-ink-3">@{p.username}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <StatusPill status={d.status} />
              <span className="inline-flex h-6 items-center rounded-full border border-line px-2.5 text-[12px] font-medium text-ink-2">{registered ? "Registered" : "Guest"}</span>
              <CopyButton value={p.id} label="Copy player id">
                {shortId(p.id)}
              </CopyButton>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-none">
          <ButtonLink href={`/profile/${encodeURIComponent(p.id)}`} target="_blank" rel="noopener noreferrer" variant="secondary" icon="external">
            Open public profile
          </ButtonLink>
          <AdjustBalanceButton profileId={p.id} />
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
        <Fact label="Joined">
          <span title={dateTime(p.createdAt)}>{dateShort(p.createdAt, true)}</span>
        </Fact>
        <Fact label="Last sign-in">{d.lastSignInAt ? <TimeAgo ts={d.lastSignInAt} /> : <span className="text-ink-3">Never</span>}</Fact>
        <Fact label="Open sessions">
          <span className="num">{num(d.openSessions)}</span>
        </Fact>
        <Fact label="Friends">
          <span className="num">{num(d.friendCount)}</span>
        </Fact>
      </dl>
    </Card>
  );
}

function BalanceCard({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card bodyClassName="p-4">
      <p className="label">{label}</p>
      <div className="mt-2.5 min-h-[30px] text-[24px] leading-none tracking-[-0.02em]">{children}</div>
      <div className="mt-2 min-h-[18px] text-[12.5px] text-ink-3">{sub}</div>
    </Card>
  );
}

function Balances({ d }: { d: UserDetail }) {
  const { withdrawable, depositPayer } = d;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:mb-5 lg:gap-4 xl:grid-cols-4">
      <BalanceCard label="Real balance" sub="Money held in the wallet">
        <Money santim={d.balances.real} className="text-[24px]" />
      </BalanceCard>
      <BalanceCard
        label="Withdrawable now"
        sub={withdrawable.held > 0 ? <>held <Money santim={withdrawable.held} unit={false} className="!text-ink-2" /> until {withdrawable.heldUntil ? dateTime(withdrawable.heldUntil) : "later"}</> : "Nothing on hold"}
      >
        <Money santim={withdrawable.amount} className="text-[24px]" />
      </BalanceCard>
      <BalanceCard label="Play balance" sub="Practice money">
        <Money santim={d.balances.play} book="play" className="text-[24px]" />
      </BalanceCard>
      <BalanceCard label="Deposit payer name" sub={depositPayer ? "Deposits must come from this name" : "Set on the first deposit"}>
        {depositPayer ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[17px] font-semibold text-ink">{depositPayer.name}</span>
            {depositPayer.locked && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-sf-2 px-2 text-[11.5px] font-medium text-ink-2">
                <Icon name="key" size={12} /> Locked
              </span>
            )}
          </span>
        ) : (
          <span className="text-[17px] font-medium text-ink-3">Not set</span>
        )}
      </BalanceCard>
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy="true">
      <Card className="mb-4 lg:mb-5" bodyClassName="p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="h-[72px] w-[72px]" />
          <div className="space-y-2.5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-6 w-56" />
          </div>
        </div>
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
          </Card>
        ))}
      </div>
      <Skeleton className="h-64 w-full" label="Loading player" />
    </div>
  );
}

export function PlayerScreen({ id }: { id: string }) {
  const { book: globalBook } = useAdminPrefs();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const { data, error, loading, reload } = useAdminQuery<UserDetail>(`users/${encodeURIComponent(id)}`);
  useAdminCrumb(data ? `@${data.profile.username}` : null);

  // The wallet tab starts on the global book and follows it when the switch changes.
  const [walletBook, setWalletBook] = useState<Book>(globalBook);
  useEffect(() => setWalletBook(globalBook), [globalBook]);

  const setTab = useCallback(
    (next: PlayerTab) => {
      const q = new URLSearchParams(window.location.search);
      if (next === "overview") q.delete("tab");
      else q.set("tab", next);
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  if (error && !data) {
    return (
      <Card>
        {error.status === 404 ? (
          <EmptyState icon="players" title="Player not found" action={<ButtonLink href="/admin/players" size="sm" icon="chevronLeft">Back to players</ButtonLink>}>
            Nobody has the id {shortId(id, 10, 6)}. They may have been mistyped in the link.
          </EmptyState>
        ) : (
          <EmptyState icon="alert" tone="error" title="Couldn't load this player" action={<Button size="sm" icon="refresh" onClick={reload}>Try again</Button>}>
            {error.message}
          </EmptyState>
        )}
      </Card>
    );
  }
  if (!data) return loading || !error ? <Loading /> : null;

  const d = data;
  const counts: Record<PlayerTab, number | null> = {
    overview: null,
    matches: d.matches,
    wallet: null,
    deposits: d.deposits.length,
    withdrawals: d.withdrawals.length,
  };
  return (
    <>
      <PlayerHeader d={d} />
      {d.status === "in-match" && d.matchId && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-recorded/40 bg-recorded/10 px-4 py-3 lg:mb-5">
          <StatusPill tone="live">In a live match</StatusPill>
          <span className="text-[13.5px] text-ink">{d.profile.name} is playing right now.</span>
          <ButtonLink href={`/admin/matches?open=${encodeURIComponent(d.matchId)}`} size="sm" variant="secondary" iconRight="chevronRight" className="ml-auto">
            Open the match
          </ButtonLink>
        </div>
      )}
      <Balances d={d} />
      <Tabs<PlayerTab>
        label="Player sections"
        value={tab}
        onChange={setTab}
        items={TABS.map((t) => ({ value: t, label: TAB_LABELS[t], count: counts[t] }))}
        className="mb-4 lg:mb-5"
      />
      <div role="tabpanel" aria-label={TAB_LABELS[tab]}>
        {tab === "overview" && <OverviewPanel detail={d} />}
        {tab === "matches" && <MatchesPanel detail={d} />}
        {tab === "wallet" && <WalletPanel detail={d} book={walletBook} onBook={setWalletBook} />}
        {tab === "deposits" && <DepositsPanel rows={d.deposits} />}
        {tab === "withdrawals" && <WithdrawalsPanel rows={d.withdrawals} />}
      </div>
    </>
  );
}
