"use client";

import { Signup } from "@/components/home/Signup";
import { JoinRoom } from "@/components/room/JoinRoom";
import { useSession } from "@/lib/session";

export default function JoinRoomPage() {
  const { ready, profile } = useSession();
  if (!ready) return null;
  return profile ? <JoinRoom /> : <Signup />;
}
