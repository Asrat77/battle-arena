// The title row at the top of every admin screen: an h1, an optional line
// under it, and actions on the right (they wrap under the title on phones).

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4 lg:mb-6">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink lg:text-[24px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
