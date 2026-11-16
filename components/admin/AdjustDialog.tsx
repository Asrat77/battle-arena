"use client";

// The one dangerous form: a manual credit or debit of a player's (or the
// platform's) balance. Three steps: the form with a live before → after preview,
// a review where the admin types the amount again, and the result with the new
// balance and the transaction id. One request at a time (a ref guards double
// clicks and a held Enter), and the dialog can't close while it is in flight.

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { adminGet, adminPost, AdminApiError, useAdminQuery } from "@/lib/admin/api";
import { birr, shortId, unitFor, type Book } from "@/lib/admin/format";
import {
  ADJUST_REASON_MAX,
  balanceAfter,
  confirmMatches,
  parseBirr,
  plainBirr,
  reasonError,
  signedAmount,
  type Direction,
} from "@/lib/admin/money";
import { useAdminPrefs } from "@/lib/admin/prefs";
import type { AdjustResult, Page, UserDetail, UserRow, WalletSummary } from "@/lib/admin/types";
import { useAdminSession } from "./AdminContext";
import { Button } from "./Button";
import { CopyButton } from "./CopyButton";
import { Field, TextArea } from "./Field";
import { Icon } from "./icons";
import { Money } from "./Money";
import { Scrim, useFocusTrap, useScrollLock } from "./Overlay";
import { AdminAvatar } from "./PlayerCell";
import { Skeleton } from "./Skeleton";

export interface AdjustPreset {
  book?: Book;
  /** A profile id or "platform". */
  profileId?: string;
  /** Opened from a player page: the account can't be changed. */
  lockAccount?: boolean;
  direction?: Direction;
  /** Santim, positive. */
  amount?: number;
  reason?: string;
}

interface Account {
  id: string;
  name: string | null;
  username: string | null;
  avatar: string | null;
}

const PLATFORM: Account = { id: "platform", name: "Platform account (fees)", username: null, avatar: null };
const accountOf = (id: string): Account => (id === "platform" ? PLATFORM : { id, name: null, username: null, avatar: null });

type Step = "form" | "review" | "done";
const STEP_TITLE: Record<Step, string> = { form: "New adjustment", review: "Review the adjustment", done: "Adjustment saved" };
const STEP_NO: Record<Step, number> = { form: 1, review: 2, done: 3 };

/** A player's or the platform's balance in one book, fresh from the API. */
function useBalance(account: Account | null, book: Book) {
  const platform = account?.id === "platform";
  const q = useAdminQuery<UserDetail | WalletSummary>(account ? (platform ? "wallet/summary" : `users/${encodeURIComponent(account.id)}`) : null, platform ? { book } : undefined);
  let balance: number | null = null;
  let detail: UserDetail | null = null;
  if (q.data) {
    if (platform && "platformBalance" in q.data && q.data.book === book) balance = q.data.platformBalance;
    if (!platform && "balances" in q.data) {
      detail = q.data;
      balance = q.data.balances[book];
    }
  }
  return { balance, detail, error: q.error, loading: q.loading, reload: q.reload };
}

function MoneyMarker({ book }: { book: Book }) {
  return book === "real" ? (
    <span className="inline-flex h-5 items-center rounded border border-accent/50 bg-accent/10 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Real money</span>
  ) : (
    <span className="inline-flex h-5 items-center rounded border border-line bg-sf-2 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">Play money</span>
  );
}

/** Search-as-you-type over players (GET users?q=), with the platform account first. */
function AccountPicker({ book, onPick }: { book: Book; onPick(a: Account): void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    const q = text.trim();
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      adminGet<Page<UserRow>>("users", { q, limit: 8, book, sort: q ? undefined : "balance" }, ctrl.signal).then(
        (r) => {
          setRows(r.rows);
          setError(null);
          setActive(0);
        },
        (e) => {
          if ((e as Error)?.name !== "AbortError") setError(e instanceof AdminApiError ? e.message : "Search failed");
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [text, book]);

  const q = text.trim().toLowerCase();
  const showPlatform = !q || "platform account fees".includes(q) || q === "platform";
  const options: (Account & { balance?: number })[] = [
    ...(showPlatform ? [PLATFORM] : []),
    ...(rows ?? []).map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar, balance: u.balance[book] })),
  ];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[active];
      if (o) onPick(o);
    }
  };

  return (
    <div>
      <div className="relative">
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          data-step-focus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
          aria-label="Find a player by name, @username or id"
          placeholder="Name, @username or id"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-lg border border-line bg-sf-2 pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-accent lg:h-10"
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Accounts" className="mt-2 max-h-[232px] overflow-y-auto rounded-lg border border-line bg-bg/60">
        {options.map((o, i) => (
          <li
            key={o.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o)}
            className={`flex min-h-[48px] cursor-pointer items-center gap-3 border-b border-line/60 px-3 py-2 last:border-0 ${i === active ? "bg-sf-2" : ""}`}
          >
            <AdminAvatar id={o.id} avatar={o.avatar} size={28} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-medium text-ink">{o.name ?? "Unknown player"}</span>
              {o.id === "platform" ? (
                <span className="block truncate text-[12px] text-ink-3">Where match fees collect</span>
              ) : (
                o.username && <span className="block truncate font-mono text-[12px] text-ink-3">@{o.username}</span>
              )}
            </span>
            {o.balance != null && <Money santim={o.balance} book={book} className="text-[13px] !text-ink-2" />}
          </li>
        ))}
        {rows === null && !error && (
          <li className="space-y-2 px-3 py-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
          </li>
        )}
        {rows && rows.length === 0 && q && <li className="px-3 py-3 text-[13px] text-ink-3">No player matches “{text.trim()}”.</li>}
        {error && (
          <li role="alert" className="px-3 py-3 text-[13px] text-mismatch">
            {error}
          </li>
        )}
      </ul>
    </div>
  );
}

function Choice({ on, onClick, children, tone }: { on: boolean; onClick(): void; children: React.ReactNode; tone: "credit" | "debit" | "plain" }) {
  const ring = !on
    ? "border-line bg-sf-2/50 text-ink-2 hover:border-ink-3/60 hover:text-ink"
    : tone === "credit"
      ? "border-recorded/70 bg-recorded/10 text-ink"
      : tone === "debit"
        ? "border-mismatch/70 bg-mismatch-soft text-ink"
        : "border-accent/70 bg-accent/10 text-ink";
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={`flex min-h-[52px] flex-1 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${ring}`}>
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2.5 last:border-0">
      <dt className="label !text-[10.5px] pt-0.5">{label}</dt>
      <dd className="min-w-0 text-right text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

export function AdjustDialog({
  open,
  preset,
  onClose,
  onDone,
}: {
  open: boolean;
  preset?: AdjustPreset;
  onClose(): void;
  /** Called once the API has written the adjustment (reload your data here). */
  onDone?(result: AdjustResult & { book: Book; profileId: string }): void;
}) {
  const prefs = useAdminPrefs();
  const { name: adminName } = useAdminSession();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const [step, setStep] = useState<Step>("form");
  const [book, setBook] = useState<Book>(prefs.book);
  const [account, setAccount] = useState<Account | null>(null);
  const [direction, setDirection] = useState<Direction>("credit");
  const [amountText, setAmountText] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdjustResult | null>(null);
  const inflight = useRef(false);

  // Fresh form each time it opens, from the preset.
  useEffect(() => {
    if (!open) return;
    setStep("form");
    setBook(preset?.book ?? prefs.book);
    setAccount(preset?.profileId ? accountOf(preset.profileId) : null);
    setDirection(preset?.direction ?? "credit");
    setAmountText(preset?.amount ? plainBirr(preset.amount) : "");
    setAmountTouched(false);
    setReason(preset?.reason ?? "");
    setReasonTouched(false);
    setTyped("");
    setBusy(false);
    setError(null);
    setResult(null);
    inflight.current = false;
    // Only when opening; the preset object may be rebuilt by the parent on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bal = useBalance(open ? account : null, book);
  const shown: Account | null = useMemo(() => {
    if (!account) return null;
    const p = bal.detail?.profile;
    return p && p.id === account.id ? { id: p.id, name: p.name, username: p.username, avatar: p.avatar ?? null } : account;
  }, [account, bal.detail]);

  const close = useCallback(() => {
    if (!inflight.current) onClose();
  }, [onClose]);
  useFocusTrap(ref, open, close);
  useScrollLock(open);

  // Move focus into each new step.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, [open, step, account]);

  if (!open) return null;

  const locked = Boolean(preset?.lockAccount && preset.profileId);
  const parsed = parseBirr(amountText);
  const santim = parsed.ok ? parsed.santim : null;
  const after = santim !== null && bal.balance !== null ? balanceAfter(bal.balance, santim, direction) : null;
  const negative = after !== null && after < 0;
  const reasonErr = reasonError(reason);
  const reasonLen = reason.trim().length;
  const ready = Boolean(account) && bal.balance !== null && santim !== null && !negative && !reasonErr;
  const unit = unitFor(book);
  const amountErr = parsed.ok ? (negative ? `This debit is more than the balance (${birr(bal.balance)} ${unit}). A balance can't go below 0.` : null) : amountTouched ? parsed.error : null;

  const toReview = (e: React.FormEvent) => {
    e.preventDefault();
    setAmountTouched(true);
    setReasonTouched(true);
    if (!ready) return;
    setError(null);
    setTyped("");
    bal.reload(); // show the freshest "before" on the review
    setStep("review");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inflight.current || !account || santim === null || !confirmMatches(typed, santim)) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<AdjustResult>("wallet/adjust", { book, profileId: account.id, amount: signedAmount(santim, direction), reason: reason.trim() });
      setResult(r);
      setStep("done");
      onDone?.({ ...r, book, profileId: account.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The adjustment failed.");
      setStep("form");
      bal.reload();
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  const ledgerHref = account ? `/admin/wallet?profileId=${encodeURIComponent(account.id)}` : "/admin/wallet";
  const verb = direction === "credit" ? "Credit" : "Debit";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <Scrim onClose={close} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className="anim-dialog relative flex max-h-[94dvh] w-full max-w-[560px] flex-col rounded-t-2xl border border-line bg-sf sm:max-h-[90dvh] sm:rounded-xl"
      >
        <header className="flex flex-none items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="label !text-[10.5px]">Step {STEP_NO[step]} of 3</p>
            <h2 id={titleId} className="mt-1 flex flex-wrap items-center gap-2 text-[17px] font-semibold text-ink">
              {STEP_TITLE[step]}
              <MoneyMarker book={book} />
            </h2>
          </div>
          <Button variant="ghost" size="sm" icon="close" aria-label="Close" onClick={close} disabled={busy} className="-mr-2 -mt-1" />
        </header>

        {step === "form" && (
          <form onSubmit={toReview} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
              {error && (
                <p role="alert" className="flex items-start gap-2 rounded-lg border border-mismatch/40 bg-mismatch-soft px-3 py-2.5 text-[13px] text-mismatch">
                  <Icon name="alert" size={16} className="mt-0.5" />
                  <span>
                    The API refused this adjustment: {error}. Nothing was changed; the form is as you left it.
                  </span>
                </p>
              )}

              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Book</legend>
                <div role="radiogroup" aria-label="Book" className="flex gap-2">
                  <Choice tone="plain" on={book === "real"} onClick={() => setBook("real")}>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14px] font-medium">
                        Real <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                      </span>
                      <span className="block text-[12px] text-ink-3">Birr players can withdraw</span>
                    </span>
                  </Choice>
                  <Choice tone="plain" on={book === "play"} onClick={() => setBook("play")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium">Play</span>
                      <span className="block text-[12px] text-ink-3">Practice money</span>
                    </span>
                  </Choice>
                </div>
              </fieldset>

              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink-2">Account</p>
                {shown ? (
                  <div className="flex items-center gap-3 rounded-lg border border-line bg-sf-2/50 px-3 py-2.5">
                    <AdminAvatar id={shown.id} avatar={shown.avatar} size={36} />
                    <div className="min-w-0 flex-1 leading-tight">
                      {shown.name ? <p className="truncate text-[14px] font-medium text-ink">{shown.name}</p> : <Skeleton className="h-4 w-32" />}
                      <p className="mt-0.5 truncate font-mono text-[12px] text-ink-3">{shown.id === "platform" ? "platform" : shown.username ? `@${shown.username}` : shortId(shown.id)}</p>
                    </div>
                    <div className="flex-none text-right">
                      <p className="label !text-[10px]">Balance</p>
                      {bal.balance !== null ? <Money santim={bal.balance} book={book} className="text-[14px]" /> : bal.error ? <span className="text-[12.5px] text-mismatch">Couldn&apos;t load</span> : <Skeleton className="mt-1 h-4 w-20" />}
                    </div>
                    {locked ? (
                      <Icon name="key" size={16} label="Locked to this player" className="text-ink-3" />
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setAccount(null)}>
                        Change
                      </Button>
                    )}
                  </div>
                ) : (
                  <AccountPicker book={book} onPick={(a) => setAccount(a)} />
                )}
                {bal.error && (
                  <p role="alert" className="mt-1.5 text-[12.5px] text-mismatch">
                    {bal.error.message}{" "}
                    <button type="button" onClick={bal.reload} className="font-medium underline underline-offset-2">
                      Retry
                    </button>
                  </p>
                )}
              </div>

              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Direction</legend>
                <div role="radiogroup" aria-label="Direction" className="flex gap-2">
                  <Choice tone="credit" on={direction === "credit"} onClick={() => setDirection("credit")}>
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-recorded/15 text-recorded">
                      <Icon name="plus" size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">Credit</span>
                      <span className="block text-[12px] text-ink-3">Add to the balance</span>
                    </span>
                  </Choice>
                  <Choice tone="debit" on={direction === "debit"} onClick={() => setDirection("debit")}>
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-mismatch/15 text-mismatch">
                      <Icon name="minus" size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">Debit</span>
                      <span className="block text-[12px] text-ink-3">Take from the balance</span>
                    </span>
                  </Choice>
                </div>
              </fieldset>

              <Field
                label="Amount in birr"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onBlur={() => setAmountTouched(true)}
                error={amountErr}
                hint="Up to 2 decimals, at most 1,000,000 birr."
                trailing={<span className="pr-2 font-mono text-[12px] text-ink-3">{unit}</span>}
              />

              <div className="rounded-lg border border-line bg-bg/60 px-3 py-3" aria-live="polite">
                <p className="label !text-[10.5px]">Preview</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[12.5px] text-ink-3">Balance now</span>
                  {bal.balance !== null ? <Money santim={bal.balance} book={book} className="text-[15px]" /> : <span className="num text-ink-3">–</span>}
                  <Icon name="chevronRight" size={16} className="text-ink-3" />
                  <span className="text-[12.5px] text-ink-3">after</span>
                  {after !== null ? <Money santim={after} book={book} className={`text-[15px] ${negative ? "!text-mismatch" : direction === "credit" ? "!text-recorded" : ""}`} /> : <span className="num text-ink-3">–</span>}
                </div>
              </div>

              <TextArea
                label="Reason"
                rows={3}
                maxLength={ADJUST_REASON_MAX + 50}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setReasonTouched(true)}
                error={reasonTouched && reasonErr ? reasonErr : null}
                hint={
                  <>
                    <span className="num font-normal">{reasonLen}/{ADJUST_REASON_MAX}</span> · Say why, and name the receipt or ticket if there is one. This is kept in the ledger and the audit log.
                  </>
                }
              />
            </div>
            <footer className="flex flex-none flex-col-reverse gap-2 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" iconRight="chevronRight" disabled={!account || bal.balance === null}>
                Review
              </Button>
            </footer>
          </form>
        )}

        {step === "review" && account && santim !== null && (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <dl className="rounded-lg border border-line bg-bg/60 px-3">
                <Row label="Book">
                  <span className="inline-flex items-center gap-2">
                    {book === "real" ? "Real" : "Play"} <MoneyMarker book={book} />
                  </span>
                </Row>
                <Row label="Account">
                  <span className="font-medium">{shown?.name ?? account.id}</span>
                  {shown?.username && <span className="ml-1.5 font-mono text-[12px] text-ink-3">@{shown.username}</span>}
                </Row>
                <Row label="Direction">
                  <span className={direction === "credit" ? "text-recorded" : "text-mismatch"}>{direction === "credit" ? "Credit (add)" : "Debit (take)"}</span>
                </Row>
                <Row label="Amount">
                  <Money santim={signedAmount(santim, direction)} book={book} signed className="text-[15px]" />
                </Row>
                <Row label="Balance">
                  {bal.balance !== null && after !== null ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <Money santim={bal.balance} book={book} unit={false} className="!text-ink-2" />
                      <Icon name="chevronRight" size={14} className="text-ink-3" />
                      <Money santim={after} book={book} className={negative ? "!text-mismatch" : ""} />
                    </span>
                  ) : (
                    <Skeleton className="ml-auto h-4 w-32" />
                  )}
                </Row>
                <Row label="Reason">
                  <span className="block whitespace-pre-wrap break-words text-left">{reason.trim()}</span>
                </Row>
                <Row label="Recorded as">
                  <span className="font-mono text-[12.5px]">admin:{adminName ?? "…"}</span>
                </Row>
              </dl>
              {negative && (
                <p role="alert" className="mt-3 text-[13px] text-mismatch">
                  The balance changed and this debit would now take it below 0. Go back and lower the amount.
                </p>
              )}
              <label className="mt-4 block">
                <span className="text-[13px] text-ink-2">
                  Type the amount <span className="num rounded bg-sf-2 px-1 py-0.5 text-ink">{plainBirr(santim)}</span> to confirm
                </span>
                <input
                  data-step-focus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Type ${plainBirr(santim)} to confirm`}
                  className="num mt-1.5 h-11 w-full rounded-lg border border-line bg-sf-2 px-3 text-[14px] text-ink outline-none focus:border-accent lg:h-10"
                />
              </label>
            </div>
            <footer className="flex flex-none flex-col-reverse gap-2 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <Button variant="ghost" icon="chevronLeft" onClick={() => setStep("form")} disabled={busy}>
                Back
              </Button>
              <Button type="submit" variant={direction === "debit" ? "danger" : "primary"} loading={busy} disabled={!confirmMatches(typed, santim) || negative || bal.balance === null}>
                {verb} {plainBirr(santim)} {unit}
              </Button>
            </footer>
          </form>
        )}

        {step === "done" && result && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-recorded/15 text-recorded">
                  <Icon name="check" size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] text-ink">
                    {direction === "credit" ? "Credited" : "Debited"} <Money santim={santim ?? 0} book={book} /> {direction === "credit" ? "to" : "from"} {shown?.name ?? "the account"}.
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">It is in the ledger and the audit log.</p>
                </div>
              </div>
              <dl className="mt-4 rounded-lg border border-line bg-bg/60 px-3">
                <Row label="New balance">
                  <Money santim={result.balance} book={book} className="text-[18px]" />
                </Row>
                <Row label="Transaction">
                  <CopyButton value={result.txn.id} label="Copy transaction id">
                    {shortId(result.txn.id, 10, 6)}
                  </CopyButton>
                </Row>
              </dl>
            </div>
            <footer className="flex flex-none flex-col-reverse gap-2 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <Link
                href={ledgerHref}
                onClick={() => {
                  prefs.setBook(book);
                  onClose();
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-sf-2 px-4 text-[14px] font-medium text-ink hover:bg-sf-3 lg:h-9"
              >
                View in ledger
              </Link>
              <Button data-step-focus variant="primary" onClick={onClose}>
                Done
              </Button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
