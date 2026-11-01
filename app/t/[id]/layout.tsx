import type { Metadata } from "next";
import { API_URL, type TournamentState } from "@/lib/api";

// Link previews (chat apps read these server-side) for /t/<id>.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const res = await fetch(`${API_URL}/api/tournaments/${encodeURIComponent(id)}`, { next: { revalidate: 30 } });
    if (!res.ok) return {};
    const t = (await res.json()) as TournamentState;
    const title = `${t.name} · Battle Arena`;
    const description = `${t.gameName} tournament, ${t.size} players, ${t.bestOf === 3 ? "best of 3" : "single game"}. ${
      t.state === "open" ? `${t.entrants.length}/${t.size} joined. Tap to join.` : t.state === "running" ? "Live now. Tap to watch." : "Finished."
    }`;
    return { title, description, openGraph: { title, description, type: "website" }, twitter: { card: "summary", title, description } };
  } catch {
    return {};
  }
}

export default function TournamentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
