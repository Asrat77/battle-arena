// Art for the quick reactions. Keys are the server's reaction IDs (chat
// REACTIONS); the art is always a 3D object, and GG is set in mono type.

import type { Icon3DName } from "@/components/ui/Icon3D";

export interface ReactionArt {
  key: string;
  label: string;
  icon?: Icon3DName;
}

export const REACTION_ART: Record<string, ReactionArt> = {
  "👍": { key: "👍", label: "thumbs up", icon: "thumbs" },
  "👏": { key: "👏", label: "clap", icon: "clap" },
  "😂": { key: "😂", label: "laugh", icon: "smile" },
  "😮": { key: "😮", label: "wow", icon: "surprise" },
  "🔥": { key: "🔥", label: "fire", icon: "flame" },
  "🤝": { key: "🤝", label: "respect", icon: "handshake" },
  "😭": { key: "😭", label: "heartbreak", icon: "brokenheart" },
  GG: { key: "GG", label: "good game" },
};

export const PLAYER_BAR = ["👏", "😮", "GG"];
export const SPECTATOR_BAR = ["👏", "😮", "🔥", "GG"];
