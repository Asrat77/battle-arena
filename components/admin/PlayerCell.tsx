// A player in a table cell: their picked animal on a neutral square, name and
// @username, linking to the admin player page. Bots get a robot and a "Bot"
// tag and no link; the platform account reads "Platform".

import Link from "next/link";
import { isAvatar } from "@/engine/avatars";
import { avatarFor } from "@/components/ui/Avatar3D";
import { Icon3D } from "@/components/ui/Icon3D";
import { Icon } from "./icons";

export function AdminAvatar({ id, avatar, bot, size = 28 }: { id: string; avatar?: string | null; bot?: boolean; size?: number }) {
  if (id === "platform") {
    return (
      <span style={{ width: size, height: size }} className="flex flex-none items-center justify-center rounded-md border border-line bg-sf-2 text-accent">
        <Icon name="layers" size={Math.round(size * 0.6)} />
      </span>
    );
  }
  const { animal } = avatarFor(id, bot, isAvatar(avatar) ? avatar : null);
  return (
    <span style={{ width: size, height: size }} className="flex flex-none items-center justify-center rounded-md border border-line bg-sf-2">
      <Icon3D name={animal} size={Math.round(size * 0.78)} />
    </span>
  );
}

export function PlayerCell({
  id,
  name,
  username,
  avatar,
  bot = false,
  href,
  size = "md",
  className = "",
}: {
  id: string;
  name: string | null;
  username?: string | null;
  avatar?: string | null;
  bot?: boolean;
  /** Defaults to /admin/players/<id>; pass null for no link. */
  href?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const platform = id === "platform";
  const link = bot || platform ? null : href === undefined ? `/admin/players/${encodeURIComponent(id)}` : href;
  const body = (
    <>
      <AdminAvatar id={id} avatar={avatar} bot={bot} size={size === "sm" ? 24 : 30} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-ink">{platform ? "Platform" : (name ?? "Unknown player")}</span>
          {bot && <span className="rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">Bot</span>}
        </span>
        {size === "md" && !bot && !platform && username && <span className="truncate font-mono text-[12px] text-ink-3">@{username}</span>}
      </span>
    </>
  );
  const cls = `inline-flex min-w-0 max-w-full items-center gap-2.5 ${className}`;
  return link ? (
    <Link href={link} className={`${cls} rounded-md hover:[&_span.font-medium]:text-accent`} onClick={(e) => e.stopPropagation()}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}
