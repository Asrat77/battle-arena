// A grey shimmering block that holds the place of content while it loads.

export function Skeleton({ className = "h-4 w-24", label }: { className?: string; label?: string }) {
  return <span aria-hidden={label ? undefined : true} role={label ? "status" : undefined} aria-label={label} className={`skeleton block rounded ${className}`} />;
}
