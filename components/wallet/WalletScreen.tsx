"use client";

// /wallet: balance, the daily play-money top-up, a way into a staked room,
// and every balance change. Stakes are held when a staked match starts and
// paid out (or refunded) when it ends; see backend/src/wallet.ts.

import { ButtonLink, Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { Page } from "@/components/ui/Page";
import { useToast } from "@/components/ui/Toast";
import { formatBirr, type WalletTxn } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useWallet } from "@/lib/useWallet";
import { DepositForm } from "./DepositForm";
import { WithdrawForm } from "./WithdrawForm";

/** Mirrors MIN_DEPOSIT in backend/src/deposits.ts. */
const MIN_DEPOSIT = 1_000;

const TXN: Record<WalletTxn["kind"], { label: string; icon: Icon3DName }> = {
  faucet: { label: "Daily top-up", icon: "gift" },
  deposit: { label: "Deposit", icon: "plus" },
  withdrawal: { label: "Withdrawal", icon: "envelope" },
  "withdrawal-refund": { label: "Withdrawal returned", icon: "refresh" },
  hold: { label: "Stake held", icon: "vault" },
  release: { label: "Stake returned", icon: "refresh" },
  win: { label: "Match won", icon: "trophy" },
  fee: { label: "Fee", icon: "token" },
};

export function WalletScreen() {
  const { ready, profile } = useSession();
  const { wallet, busy, faucet, deposit, withdraw } = useWallet();
  const toast = useToast();

  if (ready && !profile) {
    return (
      <EmptyState
        icon="vault"
        title="Wallet"
        action={
          <ButtonLink variant="act" href="/">
            Sign up to get a wallet
          </ButtonLink>
        }
      >
        Pick a name first, then play for stakes.
      </EmptyState>
    );
  }

  if (!wallet) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status">
        <span className="spin h-6 w-6 text-ink-2" aria-label="Loading your wallet" />
      </div>
    );
  }

  const play = wallet.mode === "play";
  const unit = play ? "play birr" : "birr";
  const topUp = async () => {
    const err = await faucet();
    toast.show(
      err
        ? { icon: "warning", tone: "warn", body: err }
        : { icon: "gift", body: `+${formatBirr(wallet.faucetAmount)} ${unit} added.` },
    );
  };
  const nextTopUp = wallet.faucetReadyAt
    ? new Date(wallet.faucetReadyAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <Page className="flex flex-col gap-4">
      <h1 className="text-h2">Wallet</h1>

      <section className="card flex flex-col gap-4" aria-labelledby="balance-label">
        <div className="flex items-center gap-3">
          <Icon3D name="vault" size={56} />
          <div className="min-w-0 flex-1">
            <div id="balance-label" className="eyebrow">
              Balance
            </div>
            <div className="text-[34px] font-bold leading-tight tracking-[-.03em]">
              {formatBirr(wallet.balance)} <span className="text-base font-semibold text-ink-2">{unit}</span>
            </div>
          </div>
          {play && <Chip tone="pend">Play money</Chip>}
        </div>
        {play && (
          <p className="text-small text-ink-2">
            Play birr has no cash value. It lets you try staked matches before real money is switched on.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          {play && (
            <Button variant="sec" icon="gift" block loading={busy} disabled={!!nextTopUp} onClick={topUp}>
              {nextTopUp ? `Next top-up ${nextTopUp}` : `Top up ${formatBirr(wallet.faucetAmount)}`}
            </Button>
          )}
          <ButtonLink href="/r/new?staked=1" variant="act" icon="swords" block>
            Play for stakes
          </ButtonLink>
        </div>
      </section>

      {wallet.depositAccounts.length > 0 && <DepositForm accounts={wallet.depositAccounts} minDeposit={MIN_DEPOSIT} onSubmit={deposit} />}
      {!play && wallet.depositAccounts.length === 0 && (
        <p className="card text-small text-ink-2">Deposits aren’t open yet. Check back soon.</p>
      )}

      {wallet.withdrawals.enabled && (
        <WithdrawForm
          balance={wallet.balance}
          minAmount={wallet.withdrawals.minAmount}
          requests={wallet.withdrawals.requests}
          onSubmit={withdraw}
        />
      )}

      <section className="card flex flex-col gap-1.5 text-small text-ink-2" aria-labelledby="how-label">
        <h2 id="how-label" className="eyebrow">
          How stakes work
        </h2>
        <p>
          Open a private room with a stake from {formatBirr(wallet.minStake)} to {formatBirr(wallet.maxStake)} {unit}. Both players
          put it in when the match starts.
        </p>
        <p>
          The winner takes both stakes minus a {wallet.feeBps / 100}% fee. A draw, or a match the server loses, gives both stakes back.
          Leaving or dropping off for 30 seconds forfeits.
        </p>
      </section>

      <section aria-labelledby="history-label" className="flex flex-col gap-2">
        <h2 id="history-label" className="eyebrow px-0.5">
          History
        </h2>
        {wallet.history.length === 0 ? (
          <p className="card text-ink-2">Nothing yet. Top up or play a staked match.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-line p-0">
            {wallet.history.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <Icon3D name={TXN[t.kind].icon} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{TXN[t.kind].label}</div>
                  <div className="text-small text-ink-3">{new Date(t.ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
                </div>
                <div className="text-right">
                  <div className={`mono font-semibold ${t.amount > 0 ? "text-recorded" : ""}`}>
                    {t.amount > 0 ? "+" : "−"}
                    {formatBirr(Math.abs(t.amount))}
                  </div>
                  <div className="mono text-small text-ink-3">{formatBirr(t.balance)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
