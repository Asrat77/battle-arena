"use client";

// Thin rounded orange bars over grey tracks (the inspiration's right panel).
// "vertical": one bar per item along the bottom (days), with a hover/focus
// tooltip. "horizontal": a labelled list (games, banks) with the value on the
// right. Both carry an sr-only table.

import { useState } from "react";
import { compact } from "@/lib/admin/format";
import { ChartTooltip } from "./ChartTooltip";
import { useWidth } from "./useWidth";

export interface ThinBar {
  label: string;
  value: number;
  /** The grey track's height; defaults to the chart maximum (a full-height track). */
  track?: number;
  /** Secondary line in the tooltip or under the label. */
  note?: string;
}

export function ThinBars({
  data,
  title,
  orientation = "vertical",
  height = 200,
  format = (v: number) => compact(v),
  className = "",
}: {
  data: readonly ThinBar[];
  title: string;
  orientation?: "vertical" | "horizontal";
  height?: number;
  format?(v: number): string;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.track ?? 0)));
  const table = (
    <table className="sr-only">
      <caption>{title}</caption>
      <tbody>
        {data.map((d) => (
          <tr key={d.label}>
            <th scope="row">{d.label}</th>
            <td>{format(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (orientation === "horizontal") {
    return (
      <div className={className}>
        <ul aria-hidden className="space-y-3.5">
          {data.map((d) => (
            <li key={d.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-ink-2">{d.label}</span>
                <span className="num flex-none text-ink">
                  {format(d.value)}
                  {d.note && <span className="ml-1.5 font-normal text-ink-3">{d.note}</span>}
                </span>
              </div>
              <div className="relative h-1.5 rounded-full bg-sf-3">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-accent"
                  style={{ width: `${d.value > 0 ? Math.max(2, (d.value / max) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        {table}
      </div>
    );
  }

  return <VerticalBars data={data} title={title} height={height} format={format} max={max} table={table} className={className} />;
}

function VerticalBars({
  data,
  title,
  height,
  format,
  max,
  table,
  className,
}: {
  data: readonly ThinBar[];
  title: string;
  height: number;
  format(v: number): string;
  max: number;
  table: React.ReactNode;
  className: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = Math.max(1, data.length);
  const slot = width / n;
  const barW = Math.max(2, Math.min(8, slot * 0.45));
  const xOf = (i: number) => slot * i + slot / 2;

  const onKey = (e: React.KeyboardEvent) => {
    const last = data.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active === null ? last : Math.min(last, active + 1);
    else if (e.key === "ArrowLeft") next = active === null ? last : Math.max(0, active - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <div className={className}>
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the arrow keys to read each bar.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="relative w-full rounded-md outline-offset-4"
        style={{ height }}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            aria-hidden
            className="block touch-pan-y"
            onPointerMove={(e) => {
              const i = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / slot);
              setActive(i >= 0 && i < data.length ? i : null);
            }}
            onPointerLeave={() => setActive(null)}
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke="rgb(var(--ln))" strokeDasharray="1 5" strokeLinecap="round" />
            ))}
            {data.map((d, i) => {
              const trackH = ((d.track ?? max) / max) * (height - 4);
              const h = d.value > 0 ? Math.max(barW, (d.value / max) * (height - 4)) : 0;
              const x = xOf(i) - barW / 2;
              return (
                <g key={i} opacity={active !== null && active !== i ? 0.6 : 1}>
                  <rect x={x} y={height - trackH} width={barW} height={trackH} rx={barW / 2} fill="rgb(var(--sf3))" />
                  {h > 0 && <rect x={x} y={height - h} width={barW} height={h} rx={barW / 2} fill="rgb(var(--acc))" />}
                </g>
              );
            })}
          </svg>
        )}
        {active !== null && data[active] && (
          <ChartTooltip
            x={xOf(active)}
            y={4}
            width={width}
            title={data[active].label}
            lines={[{ name: data[active].note ?? "Value", value: format(data[active].value), color: "rgb(var(--acc))" }]}
          />
        )}
      </div>
      {table}
    </div>
  );
}
