// A KPI card: mono uppercase label, a big mono value with its unit, mini bars
// on the right, and a footer with the change against the previous period
// (green up, red down, grey flat or new). `invert` for numbers where down is good.

import { percentChange, trendOf } from "@/lib/admin/format";
import { MiniBars } from "./charts/MiniBars";
import { Icon } from "./icons";
import { Skeleton } from "./Skeleton";
import { InfoTip } from "./Tooltip";

export function ChangeChip({ change, value, invert = false }: { change: number | null | undefined; value?: number; invert?: boolean }) {
  const t = trendOf(change, value);
  const good = invert ? t === "down" : t === "up";
  const bad = invert ? t === "up" : t === "down";
  const colour = good ? "text-recorded" : bad ? "text-mismatch" : "text-ink-3";
  return (
    <span className={`num inline-flex items-center gap-0.5 text-[12px] ${colour}`}>
      {t !== "flat" && <Icon name={t === "up" ? "arrowUp" : "arrowDown"} size={12} />}
      {percentChange(change, value)}
    </span>
  );
}

export function Kpi({
  label,
  value,
  unit,
  change,
  rawValue,
  invert,
  bars,
  barsLabel,
  info,
  compareLabel = "vs previous period",
  loading = false,
}: {
  label: string;
  /** Already formatted, e.g. "18.1k" or "1,234.50". */
  value: React.ReactNode;
  /** Small text after the value: "ETB", "matches". */
  unit?: string;
  /** The API ratio (or null for "new"). Leave undefined to hide the chip. */
  change?: number | null;
  /** The raw value, so a null change on 0 reads "0%" rather than "new". */
  rawValue?: number;
  invert?: boolean;
  bars?: readonly number[];
  barsLabel?: string;
  info?: React.ReactNode;
  compareLabel?: string;
  loading?: boolean;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-[10px] border border-line bg-sf">
      <div className="flex min-h-[84px] items-start gap-3 px-3.5 pb-3 pt-3.5 sm:min-h-[96px] sm:px-4">
        <div className="min-w-0 flex-1">
          <h3 className="label truncate">{label}</h3>
          {loading ? (
            <Skeleton className="mt-3 h-7 w-28" />
          ) : (
            <p className="mt-2 flex min-w-0 items-baseline gap-1.5">
              <span className="num truncate text-[21px] leading-none tracking-[-0.02em] text-ink sm:text-[24px] lg:text-[26px]">{value}</span>
              {unit && <span className="truncate text-[12px] text-ink-3">{unit}</span>}
            </p>
          )}
        </div>
        {bars && bars.length > 0 && !loading && <MiniBars values={bars} label={barsLabel ?? `${label} per day`} className="mt-1 hidden sm:flex" />}
      </div>
      <div className="mt-auto flex min-h-[36px] items-center gap-2 border-t border-line px-3.5 py-2 sm:px-4">
        {info ? <InfoTip label={`About ${label}`}>{info}</InfoTip> : <span />}
        {bars && bars.length > 0 && !loading && <MiniBars values={bars} label={barsLabel ?? `${label} per day`} height={16} max={10} className="sm:hidden" />}
        {change !== undefined && !loading && (
          <p className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-3">
            <ChangeChip change={change} value={rawValue} invert={invert} />
            <span className="hidden sm:inline">{compareLabel}</span>
          </p>
        )}
      </div>
    </section>
  );
}
