// Who may act on the moderators' Telegram buttons and prompts (withdrawals
// and deposit reviews). TELEGRAM_MODERATORS lists Telegram user ids,
// comma-separated. Without it, only the owner of a one-to-one moderator chat
// (a positive chat id is that user's own id) counts; in a group nobody does,
// so a group always needs the list.

export interface Moderators {
  /** Is this Telegram user id allowed to act? */
  allows(userId: unknown): boolean;
  /** How many people are on the list (second approvals need two). */
  readonly count: number;
}

export function moderatorList(list: string | undefined | null, chat: string | null): Moderators {
  const ids = new Set(
    String(list ?? "")
      .split(/[\s,]+/)
      .filter((x) => /^\d+$/.test(x)),
  );
  if (ids.size === 0 && chat && /^\d+$/.test(chat)) ids.add(chat);
  return {
    allows: (userId) => (typeof userId === "number" || typeof userId === "string") && ids.has(String(userId)),
    count: ids.size,
  };
}

/** The name we record for a Telegram user. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bot API JSON
export function telegramName(from: any): string {
  return from?.username ? `@${from.username}` : (from?.first_name ?? "a moderator");
}
