// Big object, one line of what happened, one way forward. Used for empty
// lists, errors and not-yet-built screens.

import { Icon3D, type Icon3DName } from "./Icon3D";

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: Icon3DName;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <Icon3D name={icon} size={96} className="animate-bob" />
      <h2 className="text-h2">{title}</h2>
      {children && <p className="max-w-sm text-ink-2">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
