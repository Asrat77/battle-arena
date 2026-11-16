"use client";

// /admin/kit: every shared admin component and chart with sample data and its
// states (loading, empty, error), for building screens and for review. Sample
// data is made up and fixed (seeded), so it renders the same on server and client.

import { useMemo, useState } from "react";
import { Button, ButtonLink } from "@/components/admin/Button";
import { Card, Inset } from "@/components/admin/Card";
import { MiniBars } from "@/components/admin/charts/MiniBars";
import { PixelBars } from "@/components/admin/charts/PixelBars";
import { ThinBars } from "@/components/admin/charts/ThinBars";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { CopyButton } from "@/components/admin/CopyButton";
import { DataTable, type Column, type SortState } from "@/components/admin/DataTable";
import { Drawer } from "@/components/admin/Drawer";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextArea } from "@/components/admin/Field";
import { FilterChips } from "@/components/admin/FilterChips";
import { Icon, ICON_NAMES } from "@/components/admin/icons";
import { Kpi } from "@/components/admin/Kpi";
import { Money } from "@/components/admin/Money";
import { PageHeader } from "@/components/admin/PageHeader";
import { PlayerCell } from "@/components/admin/PlayerCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill, type PillTone } from "@/components/admin/StatusPill";
import { Segmented, Tabs } from "@/components/admin/Tabs";
import { TimeAgo } from "@/components/admin/TimeAgo";
import { InfoTip, Tooltip } from "@/components/admin/Tooltip";
import { downloadCsv } from "@/lib/admin/csv";
import { dateShort, shortId } from "@/lib/admin/format";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 10, 15, 9);

interface SampleTxn {
  id: string;
  player: { id: string; name: string; username: string; avatar: string | null; bot?: boolean };
  kind: string;
  amount: number;
  status: string;
  ts: number;
}

const PEOPLE = [
  { id: "p_abebe", name: "Abebe Kebede", username: "abebe", avatar: "lion" },
  { id: "p_yodit", name: "Yodit Haile", username: "yodit72", avatar: "giraffe" },
  { id: "p_meron", name: "Meron Tadesse", username: "meron", avatar: null },
  { id: "p_dawit", name: "Dawit Alemu", username: "dawit_a", avatar: "owl" },
  { id: "bot", name: "Arena Bot", username: "bot", avatar: null, bot: true },
  { id: "p_selam", name: "Selamawit Girma Woldemariam", username: "selam.g", avatar: "zebra" },
];

function sampleTxns(): SampleTxn[] {
  const r = seeded(7);
  const kinds = ["deposit", "withdrawal", "win", "hold", "fee", "adjust"];
  const statuses = ["credited", "pending", "review", "rejected", "refunded", "settled"];
  return Array.from({ length: 23 }, (_, i) => {
    const kind = kinds[Math.floor(r() * kinds.length)];
    const amount = Math.round(r() * 250_000) * (kind === "withdrawal" || kind === "hold" ? -1 : 1);
    return {
      id: `tx_${(0x12ab34cd + i * 7919).toString(16)}9f3c`,
      player: PEOPLE[i % PEOPLE.length],
      kind,
      amount,
      status: statuses[Math.floor(r() * statuses.length)],
      ts: BASE - Math.round(r() * 9 * DAY),
    };
  }).sort((a, b) => b.ts - a.ts);
}

function sampleDays(n: number, seed: number) {
  const r = seeded(seed);
  return Array.from({ length: n }, (_, i) => {
    const t = BASE - (n - 1 - i) * DAY;
    const trend = 0.4 + (i / n) * 0.9;
    const weekend = [0, 6].includes(new Date(t).getUTCDay()) ? 1.35 : 1;
    const a = Math.round((8 + r() * 14) * trend * weekend);
    const b = Math.round((2 + r() * 6) * trend);
    return { label: dateShort(t), values: [a, b] as const };
  });
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="label !text-ink">{title}</h2>
        {note && <p className="mt-1 text-[12.5px] text-ink-3">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const TONES: PillTone[] = ["success", "pending", "review", "rejected", "refunded", "neutral", "live"];

export function KitScreen() {
  const txns = useMemo(sampleTxns, []);
  const days30 = useMemo(() => sampleDays(30, 3), []);
  const days90 = useMemo(() => sampleDays(90, 11), []);
  const [sort, setSort] = useState<SortState>({ key: "ts", dir: "desc" });
  const [page, setPage] = useState(0);
  const [chip, setChip] = useState("all");
  const [multi, setMulti] = useState<string[]>(["deposit", "match"]);
  const [tab, setTab] = useState("overview");
  const [seg, setSeg] = useState("monthly");
  const [q, setQ] = useState("");
  const [bank, setBank] = useState("telebirr");
  const [confirm, setConfirm] = useState<null | "plain" | "typed">(null);
  const [drawer, setDrawer] = useState(false);

  const sorted = useMemo(() => {
    const rows = txns.filter((t) => !q || t.player.name.toLowerCase().includes(q.toLowerCase()));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (sort.key === "amount" ? a.amount - b.amount : a.ts - b.ts) * dir);
  }, [txns, sort, q]);
  const PAGE = 8;
  const pageRows = sorted.slice(page * PAGE, page * PAGE + PAGE);

  const columns: Column<SampleTxn>[] = [
    { key: "player", header: "Player", primary: true, cell: (t) => <PlayerCell {...t.player} href={t.player.bot ? null : undefined} /> },
    { key: "amount", header: "Amount", align: "right", primary: true, sortKey: "amount", cell: (t) => <Money santim={t.amount} signed /> },
    { key: "id", header: "Txn", cell: (t) => <CopyButton value={t.id}>{shortId(t.id)}</CopyButton>, className: "w-[150px]" },
    { key: "kind", header: "Kind", phone: "secondary", cell: (t) => <span className="font-mono text-[12.5px] text-ink-2">{t.kind}</span> },
    { key: "status", header: "Status", phone: "secondary", cell: (t) => <StatusPill status={t.status} /> },
    { key: "ts", header: "When", phone: "secondary", align: "right", sortKey: "ts", cell: (t) => <TimeAgo ts={t.ts} mode="date" className="text-ink-2" /> },
  ];

  return (
    <div className="space-y-10">
      <PageHeader
        title="UI kit"
        subtitle="Every shared admin component with sample data and its states. Made-up data only."
        actions={
          <Button
            size="sm"
            icon="download"
            onClick={() =>
              downloadCsv("kit-sample", txns, [
                { header: "Id", value: (t) => t.id },
                { header: "Player", value: (t) => t.player.name },
                { header: "Amount (ETB)", value: (t) => t.amount / 100 },
              ])
            }
          >
            Sample CSV
          </Button>
        }
      />

      <Section title="KPI cards" note="Value, unit, mini bars, change chip (green up, red down, grey new or flat), info tooltip, loading.">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi label="Stake volume" value="18.1k" unit="ETB" change={0.124} rawValue={1} bars={days30.map((d) => d.values[0])} info="Sample info tooltip." />
          <Kpi label="Matches" value="598" unit="played" change={-0.031} rawValue={598} bars={days30.map((d) => d.values[1])} />
          <Kpi label="New players" value="12" unit="joined" change={null} rawValue={12} bars={[0, 0, 0, 1, 0, 3, 2, 6]} />
          <Kpi label="Platform fees" value="" loading change={0} />
        </div>
      </Section>

      <Section title="PixelBars" note="Two stacked series, hover or focus and use the arrow keys. 30 days with gold + grey; 90 days with two gold tones groups days on narrow screens.">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card title="Active players" info="Sample: returning and new players per day.">
            <PixelBars title="Sample active players per day" data={days30} series={[{ name: "Returning" }, { name: "New", tone: "grey" }]} />
          </Card>
          <Card title="Matches by game">
            <ThinBars
              orientation="horizontal"
              title="Sample matches by game"
              data={[
                { label: "Gebeta", value: 214, note: "41 staked" },
                { label: "Tic-tac-toe", value: 160 },
                { label: "Battleship", value: 98, note: "12 staked" },
                { label: "Dots", value: 64 },
                { label: "Bingo", value: 40 },
                { label: "Connect the dots", value: 22 },
              ]}
            />
          </Card>
        </div>
        <Card title="Stake volume, 90 days">
          <PixelBars title="Sample stake volume per day over 90 days" data={days90} series={[{ name: "Real" }, { name: "Play", tone: "soft" }]} height={180} />
        </Card>
      </Section>

      <Section title="ThinBars and MiniBars">
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card title="Fees per day">
            <ThinBars
              title="Sample fees per day"
              data={days30.map((d) => ({ label: d.label, value: d.values[0], track: d.values[0] + d.values[1] * 2, note: "Fees" }))}
              height={180}
            />
          </Card>
          <Card title="Mini bars">
            <div className="flex flex-wrap items-end gap-6">
              <MiniBars values={days30.map((d) => d.values[0])} label="Sample mini bars" />
              <MiniBars values={[3, 5, 2, 8, 6, 9, 4, 12]} label="Sample mini bars, eight values" height={24} />
              <MiniBars values={[0, 0, 0, 0, 0]} label="Sample mini bars, all zero" />
            </div>
          </Card>
        </div>
      </Section>

      <Section title="DataTable" note="Sortable headers (Amount, When), row links, pager. On phones each row becomes a compact card: primary columns on line 1, up to three secondary values on line 2 (muted, middots), the rest hidden.">
        <Card
          title="Recent transactions"
          info="Sample rows."
          bodyClassName=""
          actions={<SearchInput value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Search players…" className="w-full sm:w-[220px]" />}
        >
          <DataTable
            caption="Sample transactions"
            rows={pageRows}
            columns={columns}
            rowKey={(t) => t.id}
            sort={sort}
            onSort={(s) => { setSort(s); setPage(0); }}
            rowHref={(t) => (t.player.bot ? null : `/admin/players/${t.player.id}`)}
            pager={{ page, pageSize: PAGE, total: sorted.length, onPage: setPage }}
            empty={{ title: "No transactions match", body: "Try another name." }}
          />
        </Card>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Loading" bodyClassName="">
            <DataTable caption="Loading sample" rows={null} loading columns={columns.slice(0, 3)} rowKey={(t) => t.id} skeletonRows={4} />
          </Card>
          <Card title="Empty" bodyClassName="">
            <DataTable caption="Empty sample" rows={[]} columns={columns.slice(0, 3)} rowKey={(t) => t.id} empty={{ title: "No deposits in review", body: "New ones show up here first." }} />
          </Card>
          <Card title="Error" bodyClassName="">
            <DataTable caption="Error sample" rows={null} error="The admin API cannot be reached right now." onRetry={() => {}} columns={columns.slice(0, 3)} rowKey={(t) => t.id} />
          </Card>
        </div>
      </Section>

      <Section title="Status pills, money, players, time, ids">
        <Card>
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <StatusPill key={t} tone={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </StatusPill>
              ))}
              <StatusPill status="credited" />
              <StatusPill status="in-match" />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Money santim={123450} />
              <Money santim={250000} signed />
              <Money santim={-75050} signed />
              <Money santim={4_000_00} book="play" />
              <Money santim={null} />
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <PlayerCell {...PEOPLE[0]} />
              <PlayerCell {...PEOPLE[2]} />
              <PlayerCell {...PEOPLE[4]} />
              <PlayerCell id="platform" name="Platform" />
              <PlayerCell {...PEOPLE[1]} size="sm" />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-ink-2">
              <TimeAgo ts={BASE - 5 * 60_000} />
              <TimeAgo ts={BASE - 3 * 3600_000} mode="date" />
              <CopyButton value="0x12ab34cd56ef7890aa9f3c">{shortId("0x12ab34cd56ef7890aa9f3c")}</CopyButton>
              <Tooltip content="Tooltips show on hover and keyboard focus.">
                <button type="button" className="rounded-md border border-line px-2.5 py-1 text-[13px]">
                  Hover me
                </button>
              </Tooltip>
              <span className="flex items-center gap-1.5 text-[13px]">
                Info tip <InfoTip>Short explanation of a number.</InfoTip>
              </span>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Filters, tabs, switches, search">
        <Card>
          <div className="space-y-5">
            <FilterChips
              label="Status"
              value={chip}
              onChange={setChip}
              options={[
                { value: "all", label: "All", count: 52 },
                { value: "review", label: "In review", count: 3 },
                { value: "credited", label: "Credited", count: 45 },
                { value: "rejected", label: "Rejected", count: 4 },
              ]}
            />
            <FilterChips
              label="Types"
              multiple
              value={multi}
              onChange={setMulti}
              options={[
                { value: "signup", label: "Sign-ups" },
                { value: "match", label: "Matches" },
                { value: "deposit", label: "Deposits" },
                { value: "withdrawal", label: "Withdrawals" },
                { value: "admin", label: "Admin" },
              ]}
            />
            <Tabs
              label="Player sections"
              value={tab}
              onChange={setTab}
              items={[
                { value: "overview", label: "Overview" },
                { value: "matches", label: "Matches", count: 41 },
                { value: "wallet", label: "Wallet" },
                { value: "deposits", label: "Deposits", count: 3 },
                { value: "withdrawals", label: "Withdrawals" },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label="Period"
                value={seg}
                onChange={setSeg}
                items={[
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                  { value: "yearly", label: "Yearly" },
                ]}
              />
              <SearchInput value="" onChange={() => {}} placeholder="Search transactions…" className="w-full sm:w-[260px]" />
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Buttons">
        <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon="plus">
                New adjustment
              </Button>
              <Button icon="download">Export CSV</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Reject</Button>
              <Button variant="primary" loading>
                Saving
              </Button>
              <Button disabled>Disabled</Button>
              <Button icon="more" aria-label="More actions" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary">
                Approve
              </Button>
              <Button size="sm">Secondary</Button>
              <Button size="sm" variant="ghost" iconRight="chevronRight">
                View all
              </Button>
              <Button size="sm" variant="danger" icon="close">
                Reject
              </Button>
              <ButtonLink size="sm" href="/admin" icon="overview">
                Link button
              </ButtonLink>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Form fields">
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Amount (birr)" inputMode="decimal" placeholder="0.00" hint="Up to 10,000 birr." />
            <Field label="Reference" defaultValue="FT2531" error="This reference was already used." />
            <Select
              label="Bank"
              value={bank}
              onChange={setBank}
              options={[
                { value: "telebirr", label: "telebirr" },
                { value: "cbe", label: "CBE" },
              ]}
            />
            <TextArea label="Reason" placeholder="Why, in a sentence (at least 10 characters)" hint="Stored in the audit log." />
          </div>
        </Card>
      </Section>

      <Section title="Dialogs and drawers">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConfirm("plain")}>Confirm dialog</Button>
            <Button variant="danger" onClick={() => setConfirm("typed")}>
              Type to confirm
            </Button>
            <Button onClick={() => setDrawer(true)} icon="layers">
              Open drawer
            </Button>
          </div>
        </Card>
        <ConfirmDialog
          open={confirm === "plain"}
          title="Approve this deposit?"
          confirmLabel="Approve"
          onClose={() => setConfirm(null)}
          onConfirm={() => new Promise<void>((resolve) => setTimeout(() => { setConfirm(null); resolve(); }, 600))}
        >
          1,250.00 ETB will be credited to Abebe Kebede. This is recorded in the audit log.
        </ConfirmDialog>
        <ConfirmDialog
          open={confirm === "typed"}
          tone="danger"
          title="Debit 500.00 ETB?"
          confirmLabel="Debit"
          confirmText="500.00"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            throw new Error("Sample error: the balance would go below zero.");
          }}
        >
          The balance goes from 1,234.50 to 734.50 ETB.
        </ConfirmDialog>
        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          title="Match 0x12ab…9f3c"
          subtitle="Gebeta · 15 Nov, 22:41"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDrawer(false)}>
                Close
              </Button>
              <Button variant="primary" iconRight="external">
                Open replay
              </Button>
            </>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[13.5px]">
            <dt className="label self-center">Winner</dt>
            <dd className="justify-self-end">
              <PlayerCell {...PEOPLE[0]} />
            </dd>
            <dt className="label self-center">Stake</dt>
            <dd className="justify-self-end">
              <Money santim={50_000} />
            </dd>
            <dt className="label self-center">Status</dt>
            <dd className="justify-self-end">
              <StatusPill status="settled" />
            </dd>
          </dl>
          <Inset className="mt-5 p-3 text-[13px] text-ink-2">An inset panel for secondary details.</Inset>
        </Drawer>
      </Section>

      <Section title="Empty states and skeletons">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <EmptyState icon="deposits" title="No deposits in review">
              New ones show up here first.
            </EmptyState>
          </Card>
          <Card>
            <EmptyState icon="alert" tone="error" title="Couldn't load this" action={<Button size="sm" icon="refresh">Try again</Button>}>
              The admin API cannot be reached right now.
            </EmptyState>
          </Card>
          <Card>
            <div className="space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Icons" note="18 px, 1.5 stroke, currentColor.">
        <Card>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {ICON_NAMES.map((n) => (
              <li key={n} className="flex flex-col items-center gap-1.5 rounded-lg border border-line/60 px-1 py-3 text-ink-2">
                <Icon name={n} />
                <span className="max-w-full truncate font-mono text-[10.5px] text-ink-3">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </div>
  );
}
