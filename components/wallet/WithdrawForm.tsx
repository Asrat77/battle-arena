"use client";

// Cash out to your own Telebirr or CBE account. The amount leaves the wallet
// straight away; a moderator sends it by hand and marks it paid (or rejects
// it, which puts it back). Until a moderator picks it up the player can cancel.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { BANK_NAMES, formatBirr, SANTIM_PER_BIRR, type Withdrawal, type WithdrawalResult } from "@/lib/api";

const STATUS: Record<Withdrawal["status"], { label: string; tone: "pend" | "rec" | "bad" }> = {
  pending: { label: "Waiting", tone: "pend" },
  paid: { label: "Paid", tone: "rec" },
  rejected: { label: "Returned", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export function WithdrawForm({
  balance,
  minAmount,
  maxAmount,
  held = 0,
  heldUntil = null,
  requests,
  onSubmit,
  onCancel,
}: {
  balance: number;
  minAmount: number;
  maxAmount: number;
  /** Santim from recent deposits that can't be withdrawn until heldUntil. */
  held?: number;
  heldUntil?: number | null;
  requests: Withdrawal[];
  onSubmit: (bank: string, account: string, amount: number) => Promise<WithdrawalResult>;
  onCancel: (id: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}) {
  const toast = useToast();
  const [bank, setBank] = useState<"telebirr" | "cbe">("telebirr");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = requests.find((w) => w.status === "pending");
  const [cancelling, setCancelling] = useState(false);

  const cancel = async (id: string) => {
    setCancelling(true);
    const res = await onCancel(id);
    setCancelling(false);
    if (!res.ok) return toast.show({ icon: "warning", tone: "warn", body: res.reason });
    toast.show({ icon: "refresh", body: "Withdrawal cancelled. The money is back in your wallet." });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const santim = Math.round(Number(amount) * SANTIM_PER_BIRR);
    if (!account.trim()) return setError(bank === "telebirr" ? "Enter your Telebirr number." : "Enter your CBE account number.");
    if (!Number.isFinite(santim) || santim <= 0) return setError("Enter how much to withdraw.");
    if (santim > balance) return setError("That’s more than your balance.");
    if (santim > maxAmount) return setError(`You can withdraw up to ${formatBirr(maxAmount)} birr right now.`);
    setSending(true);
    setError(null);
    const res = await onSubmit(bank, account, santim);
    setSending(false);
    if (!res.ok) return setError(res.reason);
    setAmount("");
    toast.show({ icon: "envelope", body: `Withdrawal of ${formatBirr(santim)} birr sent to the moderators.` });
  };

  return (
    <section className="card flex flex-col gap-3.5" aria-labelledby="withdraw-label">
      <h2 id="withdraw-label" className="eyebrow">
        Withdraw
      </h2>
      {waiting ? (
        <div className="flex flex-col gap-3">
          <p className="text-small text-ink-2">
            Your withdrawal of <b className="text-ink">{formatBirr(waiting.amount)} birr</b> to {BANK_NAMES[waiting.bank]} {waiting.account} is
            with the moderators.{" "}
            {waiting.cancellable ? "You can cancel it until a moderator starts sending it." : "A moderator is sending it now."} You’ll see it here
            once it’s paid.
          </p>
          {waiting.cancellable && (
            <Button type="button" variant="ghost" icon="refresh" loading={cancelling} onClick={() => cancel(waiting.id)}>
              Cancel withdrawal
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Segmented
            label="Withdraw to"
            value={bank}
            onChange={(b) => {
              setBank(b);
              setError(null);
            }}
            options={[
              { value: "telebirr", label: "Telebirr" },
              { value: "cbe", label: "CBE" },
            ]}
          />
          <Field
            label={bank === "telebirr" ? "Your Telebirr number" : "Your CBE account number"}
            placeholder={bank === "telebirr" ? "09…" : "1000…"}
            inputMode="numeric"
            autoComplete="off"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            disabled={sending}
          />
          <Field
            label="Amount (birr)"
            hint={`At least ${formatBirr(minAmount)} birr${Number.isFinite(maxAmount) ? `, at most ${formatBirr(maxAmount)} right now` : ""}. You have ${formatBirr(balance)}.${
              held > 0 && heldUntil
                ? ` ${formatBirr(held)} from recent deposits can be played now and withdrawn from ${new Date(heldUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
                : ""
            }`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={error}
            disabled={sending}
            trailing={
              <button type="button" className="text-small font-semibold text-ink-2 hover:text-ink" onClick={() => setAmount(String(Math.min(balance, maxAmount) / SANTIM_PER_BIRR))}>
                Max
              </button>
            }
          />
          <Button type="submit" variant="sec" block loading={sending} icon="envelope" disabled={balance < minAmount || maxAmount < minAmount}>
            Request withdrawal
          </Button>
          <p className="text-small text-ink-3">A moderator sends the money by hand, usually within a day. If they can’t, it comes back to your wallet.</p>
        </form>
      )}
      {requests.length > 0 && (
        <ul className="flex flex-col divide-y divide-line" aria-label="Your withdrawals">
          {requests.map((w) => (
            <li key={w.id} className="flex items-center gap-3 py-2.5 text-small">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {formatBirr(w.amount)} birr → {BANK_NAMES[w.bank]} {w.account}
                </div>
                <div className="text-ink-3">
                  {new Date(w.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  {w.reference ? ` · ref ${w.reference}` : ""}
                </div>
              </div>
              <Chip tone={STATUS[w.status].tone}>{STATUS[w.status].label}</Chip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
