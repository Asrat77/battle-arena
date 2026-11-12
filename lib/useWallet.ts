"use client";

// The signed-in player's wallet over the socket (backend/src/wallet.ts):
// wallet:get on connect, wallet:faucet for the play-money top-up, and the
// server's wallet:balance push whenever a stake is held, refunded or won.

import { useCallback, useEffect, useState } from "react";
import type { DepositResult, WalletSummary, WithdrawalResult } from "./api";
import { useSession } from "./session";

type Ack = { ok: true; wallet: WalletSummary } | { ok: false; reason: string };

export function useWallet() {
  const { socket, connected } = useSession();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    socket?.emit("wallet:get", (res: Ack) => res.ok && setWallet(res.wallet));
  }, [socket]);

  useEffect(() => {
    if (!socket || !connected) return;
    refresh();
    // A push only carries the balance; fetch again so the history row shows too.
    const onBalance = () => refresh();
    socket.on("wallet:balance", onBalance);
    socket.on("wallet:withdrawal", onBalance);
    socket.on("wallet:deposit", onBalance);
    return () => {
      socket.off("wallet:balance", onBalance);
      socket.off("wallet:withdrawal", onBalance);
      socket.off("wallet:deposit", onBalance);
    };
  }, [socket, connected, refresh]);

  const faucet = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        if (!socket) return resolve("Not connected");
        setBusy(true);
        socket.emit("wallet:faucet", (res: Ack) => {
          setBusy(false);
          if (res.ok) setWallet(res.wallet);
          resolve(res.ok ? null : res.reason);
        });
      }),
    [socket],
  );

  /** Check a pasted Telebirr/CBE transaction number; resolves once verify.et answers (can take a minute). */
  const deposit = useCallback(
    (bank: string, reference: string, payerName: string) =>
      new Promise<DepositResult>((resolve) => {
        if (!socket) return resolve({ ok: false, reason: "Not connected" });
        socket.emit("wallet:deposit", { bank, reference, payerName }, (res: DepositResult) => {
          if (res.ok) refresh();
          resolve(res);
        });
      }),
    [socket, refresh],
  );

  /** Ask moderators to pay out `amount` santim to the player's own account. */
  const withdraw = useCallback(
    (bank: string, account: string, amount: number, password: string) =>
      new Promise<WithdrawalResult>((resolve) => {
        if (!socket) return resolve({ ok: false, reason: "Not connected" });
        socket.emit("wallet:withdraw", { bank, account, amount, password }, (res: WithdrawalResult) => {
          if (res.ok) refresh();
          resolve(res);
        });
      }),
    [socket, refresh],
  );

  /** Take back a withdrawal no moderator has picked up yet. */
  const cancelWithdrawal = useCallback(
    (id: string) =>
      new Promise<{ ok: true } | { ok: false; reason: string }>((resolve) => {
        if (!socket) return resolve({ ok: false, reason: "Not connected" });
        socket.emit("wallet:withdraw-cancel", { id }, (res: { ok: true } | { ok: false; reason: string }) => {
          if (res.ok) refresh();
          resolve(res);
        });
      }),
    [socket, refresh],
  );

  return { wallet, busy, faucet, deposit, withdraw, cancelWithdrawal, refresh };
}
