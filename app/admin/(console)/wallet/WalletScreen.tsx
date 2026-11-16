"use client";

// Wallet and ledger: the book's totals and liabilities check, the legacy report
// when there is one, and three tabs (transactions, escrows, adjustments) with
// every filter in the URL. "New adjustment" and ?adjust=<profileId|platform>
// open the adjustment dialog; after a write the screen reloads (twice: the log
// cache can hold new rows back for up to 5 s).

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdjustDialog, type AdjustPreset } from "@/components/admin/AdjustDialog";
import { Button } from "@/components/admin/Button";
import { PageHeader } from "@/components/admin/PageHeader";
import { Tabs } from "@/components/admin/Tabs";
import { useAdminQuery } from "@/lib/admin/api";
import { LEDGER_PAGE_SIZE, legacyReason, ledgerQuery, parseLedgerParams, type LegacyRow, type WalletTab } from "@/lib/admin/money";
import { useAdminPrefs } from "@/lib/admin/prefs";
import type { EscrowRow, Page, TxnPage, WalletSummary } from "@/lib/admin/types";
import { EscrowsPanel, TransactionsPanel } from "./LedgerTables";
import { LegacyCard, LiabilitiesLine, SummaryCards } from "./WalletSummaryCards";

const TAB_LABELS: Record<WalletTab, string> = { transactions: "Transactions", escrows: "Escrows", adjustments: "Adjustments" };

export function WalletScreen() {
  const { book } = useAdminPrefs();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const p = parseLedgerParams((k) => params.get(k));
  const adjustParam = (params.get("adjust") ?? "").trim();

  const setParams = useCallback(
    (changes: Record<string, string | null>, push = false) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in changes) && !("adjust" in changes)) next.delete("page");
      const s = next.toString();
      const url = s ? `${pathname}?${s}` : pathname;
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [router, pathname],
  );

  const summary = useAdminQuery<WalletSummary>("wallet/summary", { book });
  const txnParams = useMemo(() => ledgerQuery(p, book), [p.tab, p.kinds.join(","), p.profileId, p.from, p.to, p.q, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const onTxns = p.tab !== "escrows";
  const txns = useAdminQuery<TxnPage>(onTxns ? "wallet/transactions" : null, { ...txnParams, page: p.page, limit: LEDGER_PAGE_SIZE });
  const escrows = useAdminQuery<Page<EscrowRow>>(p.tab === "escrows" ? "wallet/escrows" : null, { book, status: p.status === "all" ? null : p.status, page: p.page, limit: LEDGER_PAGE_SIZE });
  const legacy = Boolean(summary.data?.legacyReport) && book === "real";
  const legacyAdjusts = useAdminQuery<TxnPage>(legacy ? "wallet/transactions" : null, { book: "real", kind: "adjust", limit: 200 });

  // The dialog: from the button, from ?adjust=, or from a legacy row.
  const [dialog, setDialog] = useState<AdjustPreset | null>(null);
  useEffect(() => {
    if (adjustParam) setDialog({ profileId: adjustParam });
  }, [adjustParam]);
  const closeDialog = () => {
    setDialog(null);
    if (adjustParam) setParams({ adjust: null });
  };

  const later = useRef<number | null>(null);
  useEffect(() => () => void (later.current && window.clearTimeout(later.current)), []);
  const reloadAll = () => {
    summary.reload();
    txns.reload();
    escrows.reload();
    legacyAdjusts.reload();
  };
  const afterWrite = () => {
    reloadAll();
    if (later.current) window.clearTimeout(later.current);
    later.current = window.setTimeout(reloadAll, 5500);
  };

  const adjustLegacy = (r: LegacyRow) =>
    setDialog({ book: "real", profileId: r.profileId, direction: "credit", amount: r.netIn, reason: legacyReason(r) });

  const counts: Record<WalletTab, number | null> = {
    transactions: null,
    escrows: summary.data?.heldEscrows ? summary.data.heldEscrows : null,
    adjustments: summary.data && summary.data.book === book ? summary.data.adjustments.count : null,
  };

  return (
    <>
      <PageHeader
        title="Wallet and ledger"
        subtitle={`${book === "real" ? "Real money" : "Play money"} book: balances, escrow and every wallet movement.`}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setDialog({})}>
            New adjustment
          </Button>
        }
      />

      <SummaryCards query={summary} book={book} />
      <LiabilitiesLine summary={summary.data} book={book} />
      {legacy && <LegacyCard report={summary.data?.legacyReport} adjusts={legacyAdjusts.data} onAdjust={adjustLegacy} />}

      <Tabs<WalletTab>
        label="Ledger sections"
        value={p.tab}
        onChange={(t) => setParams({ tab: t === "transactions" ? null : t, status: null })}
        items={(["transactions", "escrows", "adjustments"] as const).map((t) => ({ value: t, label: TAB_LABELS[t], count: counts[t] }))}
        className="mb-4"
      />
      <div role="tabpanel" aria-label={TAB_LABELS[p.tab]}>
        {p.tab === "escrows" ? (
          <EscrowsPanel p={p} book={book} query={escrows} setParams={setParams} />
        ) : (
          <TransactionsPanel p={p} book={book} query={{ ...txns, params: txnParams }} setParams={setParams} />
        )}
      </div>

      <AdjustDialog open={dialog !== null} preset={dialog ?? undefined} onClose={closeDialog} onDone={afterWrite} />
    </>
  );
}
