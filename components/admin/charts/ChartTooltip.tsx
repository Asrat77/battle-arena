// The small card that follows the hovered or focused column in a chart:
// a mono title (the day) and one line per series with its colour dot.

export interface TooltipLine {
  name: string;
  value: string;
  color: string;
}

export function ChartTooltip({ x, y, width, title, lines }: { x: number; y: number; width: number; title: string; lines: TooltipLine[] }) {
  // Sit to the right of the guide, or flip left near the right edge.
  const W = 168;
  const flip = x + 14 + W > width;
  const left = flip ? Math.max(0, x - 14 - W) : x + 14;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 rounded-lg border border-line bg-sf-2/95 p-2.5 shadow-[0_10px_30px_rgb(0_0_0/.45)] backdrop-blur"
      style={{ left, top: y, width: W }}
    >
      <p className="label mb-1.5 !text-ink">{title}</p>
      {lines.map((l) => (
        <p key={l.name} className="flex items-center gap-2 text-[12.5px] leading-6 text-ink-2">
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: l.color }} />
          <span className="min-w-0 flex-1 truncate">{l.name}</span>
          <span className="num text-ink">{l.value}</span>
        </p>
      ))}
    </div>
  );
}
