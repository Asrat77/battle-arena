"use client";

// The console's signature chart (from the inspiration): each day is a column
// of small rounded squares on a faint grid of empty cells, one or two stacked
// series. It lays itself out in real pixels for its container: wide screens
// give each day several grid columns, narrow ones group days so a column never
// gets too thin. Hover or arrow keys move a guide line with a tooltip card,
// and an sr-only table carries the numbers for screen readers.

import { useMemo, useState } from "react";
import { compact } from "@/lib/admin/format";
import { ChartTooltip } from "./ChartTooltip";
import { niceCeil, useWidth } from "./useWidth";

export interface PixelPoint {
  /** Axis and tooltip label, e.g. "15 Nov". */
  label: string;
  /** One value per series (bottom first). */
  values: readonly number[];
}

export interface PixelSeries {
  name: string;
  /** primary = gold; soft = light gold; grey = light grey. The first series defaults to primary. */
  tone?: "primary" | "soft" | "grey";
}

const TONE: Record<NonNullable<PixelSeries["tone"]>, string> = {
  primary: "rgb(var(--acc))",
  soft: "rgb(var(--acc2))",
  grey: "rgb(var(--ink3))",
};

const AXIS_W = 40;

/** The first day of a group label ("1 Nov – 3 Nov" → "1 Nov"). */
const firstLabel = (label: string) => label.split(" – ")[0];
/** Estimated width of an x label in 10.5 px mono (0.6 em per character). */
const labelWidth = (label: string) => firstLabel(label).length * 6.3;
const X_AXIS_H = 26;

interface Group {
  label: string;
  values: number[];
}

function groupPoints(points: readonly PixelPoint[], size: number, seriesCount: number): Group[] {
  if (size <= 1) return points.map((p) => ({ label: p.label, values: Array.from({ length: seriesCount }, (_, s) => p.values[s] ?? 0) }));
  const out: Group[] = [];
  // Group from the newest end so the latest group is always complete.
  const start = points.length % size === 0 ? 0 : points.length % size;
  if (start > 0) out.push(sumGroup(points.slice(0, start), seriesCount));
  for (let i = start; i < points.length; i += size) out.push(sumGroup(points.slice(i, i + size), seriesCount));
  return out;
}

function sumGroup(ps: readonly PixelPoint[], seriesCount: number): Group {
  const values = Array.from({ length: seriesCount }, (_, s) => ps.reduce((a, p) => a + (p.values[s] ?? 0), 0));
  const label = ps.length === 1 ? ps[0].label : `${ps[0].label} – ${ps[ps.length - 1].label}`;
  return { label, values };
}

export function PixelBars({
  data,
  series,
  title,
  height = 240,
  format = (v: number) => compact(v),
  axisFormat,
  legend = true,
  className = "",
}: {
  data: readonly PixelPoint[];
  series: readonly PixelSeries[];
  /** What the chart shows, for screen readers (also the sr-only table caption). */
  title: string;
  /** Plot height in px (the grid snaps to whole cells). */
  height?: number;
  /** Tooltip value format. */
  format?(v: number): string;
  /** Y-axis label format (defaults to compact numbers). */
  axisFormat?(v: number): string;
  legend?: boolean;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const seriesCount = Math.max(1, series.length);
  const colours = series.map((s, i) => TONE[s.tone ?? (i === 0 ? "primary" : "soft")]);

  const layout = useMemo(() => {
    if (width <= AXIS_W + 40 || data.length === 0) return null;
    const plotW = width - AXIS_W;
    const narrow = width < 520;
    // Group days only when even the smallest cell would not fit one column per day.
    const minCell = narrow ? 6 : 7;
    const target = narrow ? 9 : 11;
    const maxCols = Math.max(1, Math.floor((plotW + 2) / (minCell + 2)));
    const size = data.length <= maxCols ? 1 : Math.ceil(data.length / maxCols);
    const groups = groupPoints(data, size, seriesCount);
    // Each day gets as many grid columns as keeps the cells near the target size.
    const per = size === 1 ? Math.max(1, Math.round((plotW + 2) / (target + 2) / groups.length)) : 1;
    const cols = per * groups.length;
    const rawStep = (plotW + 2) / cols;
    const gap = rawStep >= 13 ? 3 : 2;
    const cell = Math.min(18, rawStep - gap);
    const step = cell + gap;
    const rows = Math.max(6, Math.floor((height + gap) / step));
    const plotH = rows * step - gap;
    const peak = Math.max(0, ...groups.map((g) => g.values.reduce((a, b) => a + b, 0)));
    const top = niceCeil(peak || 1);
    const stacks = groups.map((g) => {
      const total = g.values.reduce((a, b) => a + b, 0);
      let totalCells = Math.round((total / top) * rows);
      if (total > 0) totalCells = Math.max(1, totalCells);
      // Cells per series, bottom up, never more than the stack's total.
      let used = 0;
      const cells = g.values.map((v, i) => {
        if (i === g.values.length - 1) return Math.max(0, totalCells - used);
        let n = Math.round((v / top) * rows);
        if (v > 0) n = Math.max(1, n);
        n = Math.min(n, totalCells - used);
        used += n;
        return n;
      });
      return { cells, totalCells };
    });
    const groupW = per * step;
    // X labels: from the newest day back, each one only if it clears the one after it.
    const labelLeft = (gi: number) => {
      const cx = AXIS_W + gi * groupW + (groupW - gap) / 2;
      const tw = labelWidth(groups[gi].label);
      return Math.min(width - tw, Math.max(AXIS_W - 4, cx - tw / 2));
    };
    const shown = new Set<number>();
    let nextLeft = Infinity;
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const left = labelLeft(gi);
      if (left + labelWidth(groups[gi].label) + 12 <= nextLeft) {
        shown.add(gi);
        nextLeft = left;
      }
    }
    // Quarter ticks only when they land on whole numbers.
    const fracs = top >= 1000 || top % 4 === 0 ? [0, 0.25, 0.5, 0.75, 1] : top % 2 === 0 ? [0, 0.5, 1] : [0, 1];
    return { plotW, gap, cell, step, rows, plotH, top, per, groups, stacks, groupW, shown, fracs, cols, labelLeft };
  }, [width, data, seriesCount, height]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!layout) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left - AXIS_W;
    const i = Math.floor(x / layout.groupW);
    setActive(i >= 0 && i < layout.groups.length ? i : null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!layout) return;
    const last = layout.groups.length - 1;
    const cur = active ?? last;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(last, active === null ? last : cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, active === null ? last : cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") return setActive(null);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const ticks = layout ? layout.fracs.map((f) => ({ f, v: layout.top * f })) : [];
  const yFmt = axisFormat ?? ((v: number) => compact(v));

  return (
    <div className={`min-w-0 ${className}`}>
      {legend && series.length > 1 && (
        <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s, i) => (
            <li key={s.name} className="label flex items-center gap-1.5 !text-[10.5px]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: colours[i] }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={ref}
        className="relative w-full rounded-md outline-offset-4"
        style={{ minHeight: height + X_AXIS_H }}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the left and right arrow keys to read each day.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {layout && (
          <svg
            width={width}
            height={layout.plotH + X_AXIS_H}
            className="block touch-pan-y select-none"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setActive(null)}
            aria-hidden
          >
            {/* y axis */}
            {ticks.map(({ f, v }) => (
              <text
                key={f}
                x={AXIS_W - 10}
                y={layout.plotH - f * layout.plotH + (f === 0 ? -1 : f === 1 ? 8 : 3.5)}
                textAnchor="end"
                className="fill-ink-3 font-mono text-[10.5px]"
              >
                {yFmt(v)}
              </text>
            ))}
            {/* cells */}
            <g>
              {layout.groups.map((g, gi) =>
                Array.from({ length: layout.per }, (_, j) => {
                  const col = gi * layout.per + j;
                  const x = AXIS_W + col * layout.step;
                  const { cells } = layout.stacks[gi];
                  return Array.from({ length: layout.rows }, (_, r) => {
                    let fill = "rgb(var(--cell))";
                    let acc = 0;
                    for (let s = 0; s < cells.length; s++) {
                      if (r < acc + cells[s]) {
                        fill = colours[s] ?? colours[0];
                        break;
                      }
                      acc += cells[s];
                    }
                    const y = layout.plotH - (r + 1) * layout.step + layout.gap;
                    return (
                      <rect
                        key={`${col}-${r}`}
                        x={x}
                        y={y}
                        width={layout.cell}
                        height={layout.cell}
                        rx={Math.max(1.5, layout.cell * 0.22)}
                        fill={fill}
                        opacity={active !== null && active !== gi && fill !== "rgb(var(--cell))" ? 0.7 : 1}
                      />
                    );
                  });
                }),
              )}
            </g>
            {/* guide */}
            {active !== null && (
              <g>
                <line
                  x1={AXIS_W + active * layout.groupW + (layout.groupW - layout.gap) / 2}
                  x2={AXIS_W + active * layout.groupW + (layout.groupW - layout.gap) / 2}
                  y1={0}
                  y2={layout.plotH}
                  stroke="rgb(var(--ink2))"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <circle
                  cx={AXIS_W + active * layout.groupW + (layout.groupW - layout.gap) / 2}
                  cy={Math.max(5, layout.plotH - layout.stacks[active].totalCells * layout.step - 6)}
                  r={4}
                  fill="rgb(var(--sf))"
                  stroke="rgb(var(--ink))"
                  strokeWidth={1.5}
                />
              </g>
            )}
            {/* x axis */}
            {layout.groups.map((g, gi) => {
              const isActive = gi === active;
              const text = firstLabel(g.label).toUpperCase();
              if (!isActive && !layout.shown.has(gi)) return null;
              const left = layout.labelLeft(gi);
              if (active !== null && !isActive) {
                const aLeft = layout.labelLeft(active);
                const aw = labelWidth(layout.groups[active].label);
                if (left < aLeft + aw + 8 && left + labelWidth(g.label) + 8 > aLeft) return null;
              }
              return (
                <text
                  key={gi}
                  x={left}
                  y={layout.plotH + 18}
                  textAnchor="start"
                  className={`font-mono text-[10.5px] ${isActive ? "fill-ink" : "fill-ink-3"}`}
                >
                  {text}
                </text>
              );
            })}
          </svg>
        )}
        {layout && active !== null && (
          <ChartTooltip
            x={AXIS_W + active * layout.groupW + (layout.groupW - layout.gap) / 2}
            y={8}
            width={width}
            title={layout.groups[active].label}
            lines={[
              ...series
                .map((s, i) => ({ name: s.name, value: format(layout.groups[active].values[i] ?? 0), color: colours[i] }))
                .reverse(),
              ...(series.length > 1
                ? [{ name: "Total", value: format(layout.groups[active].values.reduce((a, b) => a + b, 0)), color: "transparent" }]
                : []),
            ]}
          />
        )}
        <p className="sr-only" aria-live="polite">
          {layout && active !== null
            ? `${layout.groups[active].label}: ${series.map((s, i) => `${s.name} ${format(layout.groups[active].values[i] ?? 0)}`).join(", ")}`
            : ""}
        </p>
      </div>
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.label}</th>
              {series.map((s, j) => (
                <td key={s.name}>{format(p.values[j] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
