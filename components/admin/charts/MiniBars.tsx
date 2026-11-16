// The tiny bars inside a KPI card: thin grey bars with the latest one in
// orange, as in the inspiration's top cards. Decorative next to the KPI's own
// number, so it is a labelled image for screen readers, not a table.

export function MiniBars({
  values,
  label,
  height = 32,
  max = 16,
  className = "",
}: {
  values: readonly number[];
  /** e.g. "Matches per day, last 16 days" */
  label: string;
  height?: number;
  /** Keep at most this many of the latest values. */
  max?: number;
  className?: string;
}) {
  const shown = values.slice(-max);
  const top = Math.max(1, ...shown);
  return (
    <div role="img" aria-label={label} className={`flex flex-none items-end gap-[3px] ${className}`} style={{ height }}>
      {shown.map((v, i) => {
        const last = i === shown.length - 1;
        const h = v > 0 ? Math.max(3, Math.round((v / top) * height)) : 2;
        return <span key={i} className={`w-[3px] rounded-full ${last ? "bg-accent" : v > 0 ? "bg-ink-3/70" : "bg-sf-3"}`} style={{ height: h }} />;
      })}
    </div>
  );
}
