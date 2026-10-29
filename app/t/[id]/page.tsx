"use client";

import { use } from "react";
import { TournamentScreen } from "@/components/tournament/TournamentScreen";

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TournamentScreen id={id} />;
}
