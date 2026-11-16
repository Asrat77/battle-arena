"use client";

// First version of the overview (task 6): greeting, range picker, four KPI
// cards and the active-players pixel chart from GET overview, enough to prove
// the foundation end to end. The overview task adds the attention strip,
// export and the transactions table.

import { Card } from "@/components/admin/Card";
import { ThinBars } from "@/components/admin/charts/ThinBars";
import { PixelBars } from "@/components/admin/charts/PixelBars";
import { Button } from "@/components/admin/Button";
import { useAdminSession } from "@/components/admin/AdminContext";
import { EmptyState } from "@/components/admin/EmptyState";
import { Kpi } from "@/components/admin/Kpi";
import { PageHeader } from "@/components/admin/PageHeader";
import { Skeleton } from "@/components/admin/Skeleton";
import { Segmented } from "@/components/admin/Tabs";
import { useAdminQuery } from "@/lib/admin/api";
import { addisHour, compact, compactBirr, dayLabel, num, unitFor } from "@/lib/admin/format";
import { RANGE_DAYS, useAdminPrefs, type RangeDays } from "@/lib/admin/prefs";
import type { Overview } from "@/lib/admin/types";

function greeting(name: string | null) {
  const h = addisHour(Date.now());
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export function OverviewScreen() {
  const { name } = useAdminSession();
  const { book, days, setDays } = useAdminPrefs();
  const { data, error, loading, reload } = useAdminQuery<Overview>("overview", { days, book }, { refreshMs: 60_000 });
  const series = data?.series ?? [];
  const k = data?.kpis;
  const unit = unitFor(book);
  const empty = !loading && !error && data && data.totals.players === 0;

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
          <Segmented<`${RangeDays}`>
            label="Range"
            value={`${days}`}
            onChange={(v) => setDays(Number(v) as RangeDays)}
            items={RANGE_DAYS.map((d) => ({ value: `${d}` as `${RangeDays}`, label: `${d} days` }))}
          />
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
        <div className="space-y-4 lg:space-y-5">
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
              compareLabel={`vs previous ${days}d`}
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
              compareLabel={`vs previous ${days}d`}
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
              compareLabel={`vs previous ${days}d`}
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
              compareLabel={`vs previous ${days}d`}
              loading={!k}
            />
          </div>

          <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card
              title="Active players"
              info="Distinct people who finished a match each day (bots left out). New means they signed up that same day."
              actions={k && <span className="num text-[13px] text-ink-2">{num(k.activePlayers.value)} in {days} days</span>}
            >
              {data ? (
                <PixelBars
                  title={`Active players per day, last ${days} days`}
                  data={series.map((d) => ({ label: dayLabel(d.day), values: [d.returningActive, d.newActive] }))}
                  series={[
                    { name: "Returning", tone: "primary" },
                    { name: "New", tone: "grey" },
                  ]}
                  format={(v) => num(v)}
                  height={250}
                />
              ) : (
                <Skeleton className="h-[290px] w-full" label="Loading chart" />
              )}
            </Card>
            <Card title="Matches by game" info="Recorded matches per game in the range; the second number is how many were staked.">
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
          </div>
        </div>
      )}
    </>
  );
}
