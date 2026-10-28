// How each badge from backend/src/rewards.ts looks on the profile, in the
// order the grid shows them. Names and rules come from GET /api/badges.

import type { Icon3DName } from "@/components/ui/Icon3D";

export const BADGE_ORDER = ["firstBlood", "codebreaker", "seedMaster", "explorer", "onARoll", "champion", "watcher"] as const;

export const BADGE_ICONS: Record<string, Icon3DName> = {
  firstBlood: "boxing",
  codebreaker: "lockpick",
  seedMaster: "sprout",
  explorer: "compass",
  onARoll: "flame",
  champion: "crown",
  watcher: "binoculars",
};

/** Short "how to earn" lines for the grid; the sheet shows the full rule. */
export const BADGE_HINTS: Record<string, string> = {
  firstBlood: "Beat a player",
  codebreaker: "Crack it in 5 rounds",
  seedMaster: "Win Gebeta by 10+",
  explorer: "Play every game",
  onARoll: "Win 3 in a row",
  champion: "Win a tournament",
  watcher: "Watch 3 to the end",
};

/** Matches watched to the end that Watcher needs (WATCHER_COUNT on the server). */
export const WATCHER_COUNT = 3;
