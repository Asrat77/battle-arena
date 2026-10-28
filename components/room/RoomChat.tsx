"use client";

// Room chat under the seats: the shared ChatPanel, keyed by the room code.

import { ChatPanel } from "@/components/chat/ChatPanel";

export function RoomChat({ code, me }: { code: string; me: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="eyebrow mt-1">Room chat</span>
      <ChatPanel roomId={code} me={me} label="Room chat" listClass="max-h-[260px] min-h-[64px]" />
    </div>
  );
}
