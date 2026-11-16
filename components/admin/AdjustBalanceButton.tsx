"use client";

// The "Adjust balance" button of the player page: opens the adjustment dialog
// locked to this player. `onDone` lets the page reload after a write.

import { useState } from "react";
import type { Book } from "@/lib/admin/format";
import { AdjustDialog } from "./AdjustDialog";
import { Button } from "./Button";

export function AdjustBalanceButton({
  profileId,
  size = "md",
  className = "",
  book,
  onDone,
}: {
  profileId: string;
  size?: "sm" | "md";
  className?: string;
  /** The book to start on (default: the global switch). */
  book?: Book;
  onDone?(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size={size} icon="wallet" className={className} onClick={() => setOpen(true)}>
        Adjust balance
      </Button>
      <AdjustDialog open={open} preset={{ profileId, lockAccount: true, book }} onClose={() => setOpen(false)} onDone={() => onDone?.()} />
    </>
  );
}
