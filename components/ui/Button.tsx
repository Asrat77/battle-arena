// Buttons from the component kit. `act` is the one saffron button per screen;
// everything else is a quiet surface. A button with a meaning gets its object.

import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { Icon3D, type Icon3DName } from "./Icon3D";

export type ButtonVariant = "act" | "sec" | "ghost" | "bad";

interface Look {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: Icon3DName;
  block?: boolean;
}

// Spelled out so Tailwind sees every class name.
const VARIANTS: Record<ButtonVariant, string> = { act: "btn-act", sec: "btn-sec", ghost: "btn-ghost", bad: "btn-bad" };

function classes({ variant = "sec", size = "md", block }: Look, extra = "") {
  return ["btn", VARIANTS[variant], size === "sm" && "btn-sm", block && "w-full", extra].filter(Boolean).join(" ");
}

function Inner({ icon, size = "md", loading, children }: Look & { loading?: boolean; children?: React.ReactNode }) {
  return (
    <>
      {loading ? <span className="spin" aria-hidden /> : icon && <Icon3D name={icon} size={size === "sm" ? 20 : 24} />}
      {children}
    </>
  );
}

export function Button({
  variant,
  size,
  icon,
  block,
  loading,
  className,
  children,
  disabled,
  ...rest
}: Look & { loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={classes({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Inner icon={icon} size={size} loading={loading}>
        {children}
      </Inner>
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  block,
  className,
  children,
  ...rest
}: Look & ComponentProps<typeof Link>) {
  return (
    <Link className={classes({ variant, size, block }, className)} {...rest}>
      <Inner icon={icon} size={size}>
        {children}
      </Inner>
    </Link>
  );
}

/** Square 44 px icon-only button (top bar, toasts). Needs a label. */
export function IconButton({
  icon,
  label,
  count,
  className = "",
  ...rest
}: { icon: Icon3DName; label: string; count?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`relative inline-flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sf ${className}`}
      {...rest}
    >
      <Icon3D name={icon} size={28} />
      {count ? <CountDot count={count} /> : null}
    </button>
  );
}

export function CountDot({ count }: { count: number }) {
  return (
    <span className="absolute right-[3px] top-[3px] flex h-[17px] min-w-[17px] items-center justify-center rounded-[9px] bg-accent px-1 font-mono text-[10px] font-bold text-accent-ink shadow-[0_0_0_2px_rgb(var(--bg))]">
      {count}
    </span>
  );
}
