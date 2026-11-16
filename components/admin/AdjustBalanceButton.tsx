"use client";

// The "Adjust balance" button of the player page. For now it opens the wallet
// screen with the player preselected (/admin/wallet?adjust=<id>); the adjustment
// dialog replaces the inside of this component without changing its props.

import { ButtonLink } from "./Button";

export function AdjustBalanceButton({ profileId, size = "md", className = "" }: { profileId: string; size?: "sm" | "md"; className?: string }) {
  return (
    <ButtonLink href={`/admin/wallet?adjust=${encodeURIComponent(profileId)}`} variant="secondary" size={size} icon="wallet" className={className}>
      Adjust balance
    </ButtonLink>
  );
}
