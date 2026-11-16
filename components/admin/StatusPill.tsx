// Status pills: a coloured dot and a label on a bordered sf2 chip, as in the
// inspiration's table. `statusTone` maps the API's status words to a tone.

export type PillTone = "success" | "pending" | "review" | "rejected" | "refunded" | "neutral" | "live";

const DOT: Record<PillTone, string> = {
  success: "text-recorded",
  pending: "text-pending",
  review: "text-accent",
  rejected: "text-mismatch",
  refunded: "text-ink-3",
  neutral: "text-ink-3",
  live: "text-recorded",
};

const TONES: Record<string, PillTone> = {
  credited: "success",
  paid: "success",
  settled: "success",
  recorded: "success",
  finished: "neutral",
  ok: "success",
  online: "success",
  review: "review",
  checking: "pending",
  pending: "pending",
  held: "pending",
  open: "pending",
  rejected: "rejected",
  failed: "rejected",
  error: "rejected",
  cancelled: "neutral",
  refunded: "refunded",
  offline: "neutral",
  running: "live",
  live: "live",
  "in-match": "live",
};

export function statusTone(status: string | null | undefined): PillTone {
  return (status && TONES[status.toLowerCase()]) || "neutral";
}

const LABELS: Record<string, string> = { "in-match": "In match", review: "In review" };

/** "credited" → "Credited". */
export function statusLabel(status: string): string {
  return LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, " ");
}

export function StatusPill({ tone, status, children }: { tone?: PillTone; status?: string; children?: React.ReactNode }) {
  const t = tone ?? statusTone(status);
  return (
    <span className="inline-flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-sf-2 pl-2 pr-2.5 text-[12px] font-medium text-ink">
      <span className={`relative h-1.5 w-1.5 rounded-full bg-current ${DOT[t]} ${t === "live" ? "ping" : ""}`} aria-hidden />
      {children ?? (status ? statusLabel(status) : "")}
    </span>
  );
}
