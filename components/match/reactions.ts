// Art for the quick reactions. Keys are the server's reaction IDs (chat
// REACTIONS); the art is always a 3D object, and GG is set in mono type.

import type { Icon3DName } from "@/components/ui/Icon3D";

export interface ReactionArt {
  key: string;
  label: string;
  /** One word under the button on wider screens. */
  short: string;
  icon?: Icon3DName;
}

export const REACTION_ART: Record<string, ReactionArt> = {
  "👍": { key: "👍", label: "thumbs up", short: "Nice", icon: "thumbs" },
  "👏": { key: "👏", label: "clap", short: "Clap", icon: "clap" },
  "😂": { key: "😂", label: "laugh", short: "Haha", icon: "smile" },
  "😮": { key: "😮", label: "wow", short: "Wow", icon: "surprise" },
  "🔥": { key: "🔥", label: "fire", short: "Fire", icon: "flame" },
  "🤝": { key: "🤝", label: "respect", short: "Respect", icon: "handshake" },
  "😭": { key: "😭", label: "heartbreak", short: "Ouch", icon: "brokenheart" },
  GG: { key: "GG", label: "good game", short: "GG" },
};

export const PLAYER_BAR = ["👏", "😮", "😂", "GG"];
export const SPECTATOR_BAR = ["👏", "😮", "🔥", "GG"];
