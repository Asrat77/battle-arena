"use client";

// Add real money: send birr to one of our accounts by Telebirr or CBE, then
// paste the transaction number. The server checks it with verify.et and
// credits the wallet only if the transfer reached our account from the name
// the player gave (fixed after their first deposit). Doubtful ones wait for a
// moderator.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { BANK_NAMES, formatBirr, type DepositResult } from "@/lib/api";

const HINTS: Record<string, { send: string; reference: string; example: string }> = {
  telebirr: {
    send: "In the telebirr app, send money to this number",
    reference: "The transaction number from the telebirr SMS, or the receipt link",
    example: "e.g. CHK1A2B3C4",
  },
  cbe: {
    send: "In CBE Birr or the CBE app, transfer to this account",
    reference: "The FT reference from the CBE receipt, or the receipt link",
    example: "e.g. FT26314ABCDE",
  },
};

export function DepositForm({
  accounts,
  payer,
  minDeposit,
  onSubmit,
}: {
  accounts: { bank: string; account: string }[];
  payer: { name: string; locked: boolean } | null;
  minDeposit: number;
  onSubmit: (bank: string, reference: string, payerName: string) => Promise<DepositResult>;
}) {
  const toast = useToast();
  const [bank, setBank] = useState(accounts[0]?.bank ?? "telebirr");
  const [reference, setReference] = useState("");
  const [payerName, setPayerName] = useState(payer?.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = accounts.find((a) => a.bank === bank) ?? accounts[0];
  const hint = HINTS[account.bank] ?? HINTS.telebirr;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account.account);
      toast.show({ icon: "check", body: `${BANK_NAMES[account.bank]} account copied`, duration: 2500 });
    } catch {
      toast.show({ icon: "warning", tone: "warn", body: `Couldn’t copy. It’s ${account.account}` });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = payer?.locked ? payer.name : payerName.trim();
    setNameError(null);
    if (name.split(/\s+/).filter((w) => w.length >= 2).length < 2) {
      return setNameError("Enter at least two names, as they appear on your account.");
    }
    const ref = reference.trim();
    if (!ref) return setError("Paste the transaction number from your receipt.");
    setChecking(true);
    setError(null);
    const res = await onSubmit(account.bank, ref, name);
    setChecking(false);
    if (!res.ok) return /name/.test(res.reason) ? setNameError(res.reason) : setError(res.reason);
    if (res.deposit.status === "credited") {
      setReference("");
      toast.show({ icon: "vault", tone: "reward", body: `+${formatBirr(res.deposit.amount ?? 0)} birr added to your wallet.` });
    } else if (res.deposit.status === "review") {
      setReference("");
      toast.show({ icon: "verified", body: res.deposit.reason ?? "A moderator will check this transfer.", duration: 8000 });
    } else {
      setError(res.deposit.reason ?? "That deposit couldn’t be confirmed.");
    }
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3.5" aria-labelledby="deposit-label" noValidate>
      <h2 id="deposit-label" className="eyebrow">
        Add money
      </h2>
      {accounts.length > 1 && (
        <Segmented
          label="Pay with"
          value={account.bank}
          onChange={(b) => {
            setBank(b);
            setError(null);
          }}
          options={accounts.map((a) => ({ value: a.bank, label: BANK_NAMES[a.bank] ?? a.bank }))}
        />
      )}
      <ol className="flex flex-col gap-3 text-small text-ink-2">
        <li className="flex flex-col gap-1.5">
          <span>
            <b className="text-ink">1.</b> {hint.send} (at least {formatBirr(minDeposit)} birr):
          </span>
          <div className="flex items-center gap-2 rounded-[14px] bg-sf-2 px-3.5 py-2.5">
            <span className="mono flex-1 truncate text-base font-semibold text-ink">{account.account}</span>
            <Button type="button" size="sm" variant="ghost" icon="link" onClick={copy}>
              Copy
            </Button>
          </div>
        </li>
        <li>
          <b className="text-ink">2.</b> Paste the transaction number below. We check it with verify.et and add the amount you sent.
        </li>
      </ol>
      {payer?.locked ? (
        <p className="text-small text-ink-2">
          Paying from <b className="text-ink">{payer.name}</b>. Deposits from another name are checked by a moderator first.
        </p>
      ) : (
        <Field
          label="Name on your account"
          hint="As your Telebirr or CBE account shows it. Deposits are matched to this name, and it can’t be changed once a deposit is credited or sent to a moderator."
          placeholder="e.g. Abebe Bikila"
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          error={nameError}
          autoComplete="name"
          disabled={checking}
        />
      )}
      <Field
        label="Transaction number"
        hint={hint.reference}
        placeholder={hint.example}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        error={error}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={checking}
      />
      <Button type="submit" variant="act" block loading={checking} icon={checking ? undefined : "verified"}>
        {checking ? "Checking with verify.et…" : "Confirm deposit"}
      </Button>
      <p className="text-small text-ink-3">
        Each transaction can be used once, within a day of sending. It can take up to a minute to confirm.
      </p>
    </form>
  );
}
