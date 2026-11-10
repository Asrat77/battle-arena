"use client";

// The signed-in player's wallet over the socket (backend/src/wallet.ts):
// wallet:get on connect, wallet:faucet for the play-money top-up, and the
// server's wallet:balance push whenever a stake is held, refunded or won.

import { useCallback, useEffect, useState } from "react";
import type { WalletSummary } from "./api";
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
    return () => {
      socket.off("wallet:balance", onBalance);
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

  return { wallet, busy, faucet, refresh };
}
