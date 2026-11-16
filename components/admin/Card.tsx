// The admin card: a thin-bordered sf panel with an optional title row (mono
// uppercase label, info tooltip, actions on the right). `inset` is the darker
// panel inside a card, as around the inspiration's big chart.

import { InfoTip } from "./Tooltip";

export function Card({
  title,
  info,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
  as: Tag = "section",
}: {
  title?: React.ReactNode;
  /** Shown in an (i) tooltip beside the title. */
  info?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={`min-w-0 rounded-[10px] border border-line bg-sf ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          {title && (
            <h2 className="label flex min-w-0 items-center gap-1.5">
              <span className="truncate">{title}</span>
              {info && <InfoTip>{info}</InfoTip>}
            </h2>
          )}
          {actions && <div className="ml-auto flex max-w-full flex-wrap items-center gap-2 max-sm:has-[input]:w-full">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </Tag>
  );
}

/** A darker panel inside a card. */
export function Inset({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-bg/60 ${className}`}>{children}</div>;
}
