"use client";

import { GameCards } from "@/components/home/GameCards";
import { SideColumn } from "@/components/home/SideColumn";
import { Signup } from "@/components/home/Signup";
import { useSession } from "@/lib/session";

export default function Home() {
  const { ready, profile } = useSession();
  if (!ready) return <p className="text-sm text-ink-2">Loading…</p>;
  if (!profile) return <Signup />;
  return (
    <div className="relative">
      <div className="dither -mx-4 -mt-6 md:-mx-6" />
      <div className="relative flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5 md:gap-[22px]">
          <header className="flex flex-col gap-1.5 px-0.5 pt-1.5">
            <span className="eyebrow">Live 1v1 · every result recorded</span>
            <h1 className="text-[30px] font-semibold leading-[1.02] tracking-[-.045em] md:text-[clamp(34px,4.4vw,56px)]">
              Pick a game, {profile.name}.
            </h1>
            <p className="hidden text-[17px] text-ink-2 md:block">
              Quick match finds someone in seconds. Nobody around? A bot is offered after 10.
            </p>
          </header>
          <GameCards />
        </div>
        <SideColumn profile={profile} />
      </div>
    </div>
  );
}
