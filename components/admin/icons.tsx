// The admin site's line icons: 24-unit paths drawn at 18 px with a 1.5 stroke
// in currentColor, so they take the text colour. Kept here (not the player
// app's 3D icons) because the console is meant to read quiet and precise.

import type { SVGProps } from "react";

const PATHS = {
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  players: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.8 3.1 2.6 3.5 5.2",
  matches: "M14.5 4.5 20 4l-.5 5.5L9 20l-5-5zM12 7l5 5M4 20l2.5-2.5M5 14l5 5",
  tournaments: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z",
  wallet: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5zM16.5 13.5h.01",
  deposits: "M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  withdrawals: "M12 14V3M7.5 7.5 12 3l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  reconcile: "M12 4v16M5 20h14M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0zM6 8h12M12 4l-6 4M12 4l6 4",
  audit: "M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15M8.5 11.5h7M8.5 15h7M8.5 18.5h4",
  system: "M4 5h16v6H4zM4 13h16v6H4zM7.5 8h.01M7.5 16h.01M11 8h5M11 16h5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronLeft: "M14.5 6l-6 6 6 6",
  chevronDown: "M6 9.5l6 6 6-6",
  chevronUpDown: "M8 9.5l4-4 4 4M8 14.5l4 4 4-4",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  arrowUpRight: "M7 17 17 7M8 7h9v9",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01",
  alert: "M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01",
  copy: "M9 9h10v11H9zM15 9V5a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  logout: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  filter: "M4 5h16l-6 7.5V19l-4 1.5v-8z",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14",
  calendar: "M5 6h14v14H5zM5 10h14M9 3.5v4M15 3.5v4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  bot: "M6 9h12v10H6zM12 9V5.5M12 5.5h.01M9.5 13.5h.01M14.5 13.5h.01M9.5 16.5h5M3.5 13v3M20.5 13v3",
  refresh: "M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2",
  shield: "M12 3 5 6v5.5c0 4.3 3 7.8 7 9.5 4-1.7 7-5.2 7-9.5V6zM9 12l2 2 4-4",
  inbox: "M4 13l2.5-8h11l2.5 8M4 13v6h16v-6M4 13h4.5l1 2.5h5l1-2.5H20",
  key: "M15 14a5 5 0 1 0-4.6-3L3.5 18v2.5H6v-2h2v-2h2l2.3-2.3A5 5 0 0 0 15 14zM16.5 7.5h.01",
  dot: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  layers: "M12 4 3 8.5l9 4.5 9-4.5zM3 12.5l9 4.5 9-4.5M3 16.5 12 21l9-4.5",
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({
  name,
  size = 18,
  label,
  className = "",
  ...rest
}: { name: IconName; size?: number; label?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={`flex-none ${className}`}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
