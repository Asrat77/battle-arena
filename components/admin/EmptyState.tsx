// Quiet empty, error and "being built" states: a line icon in a ring, a title,
// one sentence and an optional action.

import { Icon, type IconName } from "./icons";

export function EmptyState({
  icon = "inbox",
  title,
  children,
  action,
  tone = "neutral",
  className = "",
}: {
  icon?: IconName;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "error";
  className?: string;
}) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      <span
        className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl border ${
          tone === "error" ? "border-mismatch/40 bg-mismatch-soft text-mismatch" : "border-line bg-sf-2 text-ink-2"
        }`}
      >
        <Icon name={icon} size={22} />
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-[13px] text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
