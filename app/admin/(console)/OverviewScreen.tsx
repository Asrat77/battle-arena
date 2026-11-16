"use client";

// The overview, the screen the owner opens every morning: greeting with range,
// export and refresh; the "needs attention" strip; two rows of KPI cards; the
// main chart with a metric switch; recent transactions and activity; matches by
// game and the players card. Refreshes itself every minute without flashing
// skeletons (the query keeps the old data while it reloads).

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/Card";
import { ThinBars } from "@/components/admin/charts/ThinBars";
import { PixelBars } from "@/components/admin/charts/PixelBars";
import { Button } from "@/components/admin/Button";
import { useAdminSession } from "@/components/admin/AdminContext";
import { EmptyState } from "@/components/admin/EmptyState";
import { Icon } from "@/components/admin/icons";
import { Kpi } from "@/components/admin/Kpi";
import { PageHeader } from "@/components/admin/PageHeader";
import { Skeleton } from "@/components/admin/Skeleton";
import { Segmented } from "@/components/admin/Tabs";
import { downloadCsv } from "@/lib/admin/csv";
import { useAdminQuery } from "@/lib/admin/api";
import { addisHour, compact, compactBirr, dayLabel, num, unitFor } from "@/lib/admin/format";
import {
  CSV_COLUMNS,
  METRICS,
  axisFormatFor,
  chartIsEmpty,
  chartModel,
  chartTotalText,
  csvFilename,
  csvRows,
  netFlowChange,
  netFlowSeries,
  netFlowTotal,
  updatedAgo,
  valueFormatFor,
  type Metric,
} from "@/lib/admin/overview";
import { RANGE_DAYS, useAdminPrefs, type RangeDays } from "@/lib/admin/prefs";
import type { ActivityRow, Overview, Page, Reconcile, TxnPage } from "@/lib/admin/types";
import { AttentionStrip } from "./OverviewAttention";
import { ActivityCard, PlayersCard, TransactionsCard } from "./OverviewTables";

function greeting(name: string | null) {
  const h = addisHour(Date.now());
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

const SWITCH_LABELS: Record<Metric, string> = { active: "Players", matches: "Matches", stake: "Stake", fees: "Fees", money: "In/out" };
const isMetric = (v: string | null): v is Metric => !!v && (METRICS as readonly string[]).includes(v);

export function OverviewScreen() {
  const { name } = useAdminSession();
  const { book, days, setDays } = useAdminPrefs();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const metric: Metric = isMetric(params.get("metric")) ? (params.get("metric") as Metric) : "active";
  const q = params.get("q") ?? "";

  // Filters live in the URL so a link or the back button restores them.
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (value) next.set(key, value);
      else next.delete(key);
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const overview = useAdminQuery<Overview>("overview", { days, book, tz: 180 }, { refreshMs: 60_000 });
  const txns = useAdminQuery<TxnPage>("wallet/transactions", { book, q, limit: 8 }, { refreshMs: 60_000 });
  const activity = useAdminQuery<Page<ActivityRow>>("activity", { limit: 8 }, { refreshMs: 60_000 });
  const reconcile = useAdminQuery<Reconcile>("wallet/reconcile", undefined, { refreshMs: 300_000 });
  const { data, error, loading, reload } = overview;

  // "Updated 12s ago": stamp each fresh answer, tick every 5 s.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (data) setUpdatedAt(Date.now());
  }, [data]);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const refreshAll = () => {
    overview.reload();
    txns.reload();
    activity.reload();
    reconcile.reload();
  };

  const series = data?.series ?? [];
  const k = data?.kpis;
  const unit = unitFor(book);
  const real = book === "real";
  const empty = !loading && !error && data && data.totals.players === 0;
  const model = chartModel(metric, series, days, k);
  const net = netFlowTotal(series);
  const refreshFailed = Boolean(error && data);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(csvFilename(days, book, series), csvRows(series), CSV_COLUMNS);
  };

  const moneyHint = "Real money only";
  const cmp = `vs previous ${days}d`;
  const todayKey = series.length ? series[series.length - 1].day : null;

  return (
    <>
      <PageHeader
        title={<span suppressHydrationWarning>{greeting(name)}</span>}
        subtitle={
          data ? (
            <>
              {num(data.now.online)} online now · {num(data.now.liveMatches)} live {data.now.liveMatches === 1 ? "match" : "matches"} · {num(data.totals.players)} players in total
            </>
          ) : (
            "How Battle Arena is doing."
          )
        }
        actions={
          <>
            <Segmented<`${RangeDays}`>
              label="Range"
              value={`${days}`}
              onChange={(v) => setDays(Number(v) as RangeDays)}
              items={RANGE_DAYS.map((d) => ({ value: `${d}` as `${RangeDays}`, label: `${d} days` }))}
            />
            <Button size="sm" icon="download" onClick={exportCsv} disabled={!data}>
              Export CSV
            </Button>
            <div className="flex items-center gap-1">
              <span className={`text-[12px] ${refreshFailed ? "text-pending" : "text-ink-3"}`} aria-live="polite">
                {refreshFailed ? "Couldn't refresh" : updatedAt ? `Updated ${updatedAgo(updatedAt, Date.now())}` : ""}
              </span>
              <Button size="sm" variant="ghost" aria-label="Refresh the overview" onClick={refreshAll} disabled={loading && !data}>
                <Icon name="refresh" size={16} className={loading && data ? "animate-spin" : ""} />
              </Button>
            </div>
          </>
        }
      />

      {error && !data ? (
        <Card>
          <EmptyState icon="alert" tone="error" title="Couldn't load the overview" action={<Button size="sm" icon="refresh" onClick={reload}>Try again</Button>}>
            {error.message}
          </EmptyState>
        </Card>
      ) : empty ? (
        <Card>
          <EmptyState icon="players" title="No players yet">
            The numbers fill in as soon as people sign up and play.
          </EmptyState>
        </Card>
      ) : (
        <div>
          <AttentionStrip now={data?.now ?? null} reconcile={reconcile.data} reconcileFailed={Boolean(reconcile.error)} />

          <div className="grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
            <Kpi
              label="Stake volume"
              value={k ? compactBirr(k.stakeVolume.value) : ""}
              unit={unit}
              change={k?.stakeVolume.change}
              rawValue={k?.stakeVolume.value}
              bars={series.map((d) => d.stakeVolume)}
              barsLabel="Stake volume per day"
              info="Every stake held for a match in the range, both players' stakes counted."
              compareLabel={cmp}
              loading={!k}
            />
            <Kpi
              label="Matches"
              value={k ? compact(k.matches.value) : ""}
              unit="played"
              change={k?.matches.change}
              rawValue={k?.matches.value}
              bars={series.map((d) => d.matches)}
              barsLabel="Matches per day"
              info="Recorded matches that ended in the range, against bots and people."
              compareLabel={cmp}
              loading={!k}
            />
            <Kpi
              label="New players"
              value={k ? compact(k.newPlayers.value) : ""}
              unit="joined"
              change={k?.newPlayers.change}
              rawValue={k?.newPlayers.value}
              bars={series.map((d) => d.signups)}
              barsLabel="Sign-ups per day"
              info="Profiles created in the range, guests included."
              compareLabel={cmp}
              loading={!k}
            />
            <Kpi
              label="Platform fees"
              value={k ? compactBirr(k.fees.value) : ""}
              unit={unit}
              change={k?.fees.change}
              rawValue={k?.fees.value}
              bars={series.map((d) => d.fees)}
              barsLabel="Fees per day"
              info="The platform's cut of staked matches in the range."
              compareLabel={cmp}
              loading={!k}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:mt-4 lg:gap-4 xl:grid-cols-4">
            <Kpi
              label="Active players"
              value={k ? compact(k.activePlayers.value) : ""}
              unit="players"
              change={k?.activePlayers.change}
              rawValue={k?.activePlayers.value}
              bars={series.map((d) => d.activePlayers)}
              barsLabel="Active players per day"
              info="Distinct people who finished a match in the range (bots left out)."
              compareLabel={cmp}
              loading={!k}
            />
            <Kpi
              label="Deposits"
              value={k ? (real ? compactBirr(k.deposits.value) : "–") : ""}
              unit={real ? unit : undefined}
              change={k?.deposits.change}
              rawValue={k?.deposits.value}
              bars={series.map((d) => d.deposits)}
              barsLabel="Deposits per day"
              info="Credited deposits in the range, by the time they were credited."
              compareLabel={cmp}
              muted={!real}
              hint={moneyHint}
              loading={!k}
            />
            <Kpi
              label="Withdrawals"
              value={k ? (real ? compactBirr(k.withdrawals.value) : "–") : ""}
              unit={real ? unit : undefined}
              change={k?.withdrawals.change}
              rawValue={k?.withdrawals.value}
              bars={series.map((d) => d.withdrawals)}
              barsLabel="Withdrawals per day"
              info="Paid withdrawals in the range, by the time they were paid."
              compareLabel={cmp}
              muted={!real}
              hint={moneyHint}
              loading={!k}
            />
            <Kpi
              label="Net flow"
              value={k ? (real ? `${net > 0 ? "+" : net < 0 ? "−" : ""}${compactBirr(Math.abs(net))}` : "–") : ""}
              unit={real ? unit : undefined}
              change={k ? netFlowChange(k) : undefined}
              rawValue={net}
              bars={netFlowSeries(series).map(Math.abs)}
              barsLabel="Net flow per day (size of the daily difference)"
              info="Deposits minus withdrawals in the range. Positive means more money came in than went out."
              compareLabel={cmp}
              muted={!real}
              hint={moneyHint}
              loading={!k}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:mt-5 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
              <Card
                title={METRIC_TITLES[metric]}
                info="Per local day (Addis Ababa). The last column is today and is still filling up."
                actions={
                  data && (
                    <span className="num text-[13px] text-ink-2">
                      {chartTotalText(model)}
                      {model.money && <span className="ml-1 text-ink-3">{unit}</span>} <span className="font-normal text-ink-3">{model.totalNote}</span>
                    </span>
                  )
                }
              >
                <div className="mb-4 overflow-x-auto">
                  <Segmented<Metric>
                    label="Chart metric"
                    size="sm"
                    value={metric}
                    onChange={(v) => setParam("metric", v === "active" ? null : v)}
                    items={METRICS.map((m) => ({ value: m, label: SWITCH_LABELS[m] }))}
                  />
                </div>
                {!data ? (
                  <Skeleton className="h-[300px] w-full" label="Loading chart" />
                ) : !real && metric === "money" ? (
                  <EmptyState icon="wallet" title="Real money only" className="!py-16">
                    Deposits and withdrawals exist only in the real-money book. Switch the book in the top bar to see them.
                  </EmptyState>
                ) : (
                  <>
                    <PixelBars
                      title={model.title}
                      data={model.points.map((p) => ({ label: p.label, values: p.values }))}
                      series={model.series}
                      format={valueFormatFor(model.money)}
                      axisFormat={axisFormatFor(model.money)}
                      height={340}
                    />
                    <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
                      {chartIsEmpty(model)
                        ? "Nothing recorded for this in the range."
                        : todayKey && `Today (${dayLabel(todayKey)}) is still in progress.`}
                    </p>
                  </>
                )}
              </Card>
              <TransactionsCard query={txns} book={book} q={q} onSearch={(v) => setParam("q", v || null)} />
            </div>

            <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
              <ActivityCard query={activity} className="xl:order-3 xl:flex-1" />
              <Card className="xl:order-1" title="Matches by game" info="Recorded matches per game in the range; the second number is how many were staked.">
                {data ? (
                  data.byGame.length ? (
                    <ThinBars
                      orientation="horizontal"
                      title={`Matches by game, last ${days} days`}
                      data={data.byGame.map((g) => ({ label: g.gameName, value: g.matches, note: g.staked ? `${num(g.staked)} staked` : undefined }))}
                      format={(v) => num(v)}
                    />
                  ) : (
                    <EmptyState icon="matches" title="No matches in this range" className="!py-8" />
                  )
                ) : (
                  <div className="space-y-4">
                    {Array.from({ length: 6 }, (_, i) => (
                      <Skeleton key={i} className="h-7 w-full" />
                    ))}
                  </div>
                )}
              </Card>
              <div className="contents xl:order-2 xl:block">
                <PlayersCard totals={data?.totals ?? null} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const METRIC_TITLES: Record<Metric, string> = {
  active: "Active players",
  matches: "Matches",
  stake: "Stake volume",
  fees: "Fees",
  money: "Money in and out",
};
