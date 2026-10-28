"use client";

import { use } from "react";
import { QueueScreen } from "@/components/queue/QueueScreen";

export default function QueuePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params);
  return <QueueScreen gameId={gameId} />;
}
