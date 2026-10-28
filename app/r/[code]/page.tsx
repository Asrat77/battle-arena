"use client";

import { use } from "react";
import { RoomScreen } from "@/components/room/RoomScreen";
import { normalizeCode } from "@/components/room/useRoom";

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <RoomScreen code={normalizeCode(code)} />;
}
