"use client";

import Link from "next/link";
import { GameCards } from "@/components/home/GameCards";
import { LiveNow } from "@/components/home/LiveNow";
import { SideColumn } from "@/components/home/SideColumn";
import { Signup } from "@/components/home/Signup";
import { Icon3D } from "@/components/ui/Icon3D";
import { useSession } from "@/lib/session";

export default function Home() {
  const { ready, profile } = useSession();
  if (!ready) return <p className="text-sm text-ink-2">Loading…</p>;
  if (!profile) return <Signup />;
  return (
    <div className="relative">
      <div className="dither -mx-4 -mt-6 md:-mx-6" />
      <div className="relative flex flex-wrap items-start gap-6 lg:h-[calc(100dvh-142px)] lg:min-h-[600px] lg:flex-nowrap">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5 md:gap-[22px] lg:h-full lg:flex-1">
          <header className="flex flex-col gap-1.5 px-0.5 pt-1.5">
            <span className="eyebrow">Live 1v1 · every result recorded</span>
            <h1 className="text-[30px] font-semibold leading-[1.02] tracking-[-.045em] md:text-[clamp(34px,4.4vw,56px)]">
              Pick a game, {profile.name}.
            </h1>
            <p className="hidden text-[17px] text-ink-2 md:block [@media(min-width:1024px)_and_(max-height:780px)]:hidden">
              Quick match finds someone in seconds. Nobody around? A bot is offered after 10.
            </p>
            <Link href="/r" className="chip mt-1 w-fit hover:text-ink">
              <Icon3D name="key" size={18} />
              Have a room code? Join
            </Link>
          </header>
          <GameCards />
          <LiveNow className="lg:hidden" />
        </div>
        <SideColumn profile={profile} />
      </div>
    </div>
  );
}
