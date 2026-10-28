// Every icon, avatar, badge and game piece is a 3D object image (Thiings set,
// 256 px WebP in public/3d). Decorative by default; pass `label` when the icon
// is the only content of its control.

import type { CSSProperties } from "react";

export const ICONS = [
  "bean", "binoculars", "blockchain", "boxing", "brokenheart", "chat", "check", "cheetah",
  "clap", "coffeecup", "compass", "confetti", "controller", "crown", "elephant", "envelope",
  "err404", "fennec", "flame", "friends", "gelada", "gift", "giraffe", "handshake",
  "hedgehog", "hippo", "hourglass", "ibex", "idcard", "key", "keypad", "lightning", "link",
  "lion", "lockpick", "magnifier", "mancala", "manual", "medalbronze", "medalgold",
  "medalsilver", "notification", "openlock", "owl", "padlock", "parrot", "pebble", "pebble2",
  "plus", "podium", "popper", "profile", "refresh", "robot", "satellite", "share", "smile",
  "sprout", "stopwatch", "surprise", "swords", "target", "thumbs", "token", "trophy",
  "unverified", "vault", "verified", "vs", "warning", "whiteflag", "xmark", "zebra",
] as const;

export type Icon3DName = (typeof ICONS)[number];

export function Icon3D({
  name,
  size = 28,
  label,
  className = "",
  style,
}: {
  name: Icon3DName;
  size?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already 256 px WebP; next/image adds nothing here
    <img
      src={`/3d/${name}.webp`}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={`block flex-none select-none object-contain ${className}`}
      style={style}
    />
  );
}
