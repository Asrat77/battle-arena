"use client";

// Room chat under the seats: the shared ChatPanel, keyed by the room code.

import { ChatPanel } from "@/components/chat/ChatPanel";

export function RoomChat({ code, me, className = "" }: { code: string; me: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2.5 lg:self-start lg:rounded-sheet lg:bg-sf lg:p-4 ${className}`}>
      <span className="eyebrow mt-1 lg:mt-0">Room chat</span>
      <ChatPanel roomId={code} me={me} label="Room chat" listClass="max-h-[260px] min-h-[64px] lg:max-h-[420px] lg:min-h-[280px]" />
    </div>
  );
}
