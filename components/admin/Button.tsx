"use client";

// Admin buttons: primary (the one orange action), secondary, ghost and danger,
// in sm (32 px, 40 on phones) and md (36 px, 44 on phones) so touch targets stay
// big enough. `href` renders a Link with the same look.

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-action text-action-ink hover:brightness-110 disabled:bg-sf-3 disabled:text-ink-3 disabled:hover:brightness-100",
  secondary: "border border-line bg-sf-2 text-ink hover:bg-sf-3",
  ghost: "text-ink-2 hover:bg-sf-2 hover:text-ink",
  danger: "border border-mismatch/40 bg-mismatch-soft text-mismatch hover:bg-mismatch/20",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-10 gap-1.5 px-3 text-[13px] lg:h-8 lg:px-2.5",
  md: "h-11 gap-2 px-4 text-[14px] lg:h-9 lg:px-3.5",
};

const ICON_ONLY: Record<ButtonSize, string> = {
  sm: "h-10 w-10 lg:h-8 lg:w-8",
  md: "h-11 w-11 lg:h-9 lg:w-9",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", iconOnly = false, extra = "") {
  return `inline-flex flex-none select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-[background-color,color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${iconOnly ? ICON_ONLY[size] : SIZES[size]} ${extra}`;
}

function Spinner() {
  return <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />;
}

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Icon after the label (e.g. chevronRight). */
  iconRight?: IconName;
  /** With no children: an icon-only square button. Give it `aria-label`. */
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, Common & ButtonHTMLAttributes<HTMLButtonElement>>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, loading, children, className = "", disabled, type = "button", ...rest },
  ref,
) {
  const iconOnly = !children;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, iconOnly, className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
      {iconRight && <Icon name={iconRight} size={16} />}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  children,
  className = "",
  ...rest
}: Common & { href: string; children?: React.ReactNode; className?: string; "aria-label"?: string; target?: string; rel?: string }) {
  return (
    <Link href={href} className={buttonClass(variant, size, !children, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
      {iconRight && <Icon name={iconRight} size={16} />}
    </Link>
  );
}
