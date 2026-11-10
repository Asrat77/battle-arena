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
  const params = useSearchParams();
  const stake = Number(params.get("stake"));
  return (
    <CreateRoom
      gameId={params.get("game")}
      staked={params.get("staked") === "1" || stake > 0}
      stake={Number.isInteger(stake) && stake > 0 ? stake : null}
    />
  );
}
