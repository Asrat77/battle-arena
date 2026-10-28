"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CreateRoom } from "@/components/room/CreateRoom";

export default function NewRoomPage() {
  return (
    <Suspense>
      <NewRoom />
    </Suspense>
  );
}

function NewRoom() {
  return <CreateRoom gameId={useSearchParams().get("game")} />;
}
