// The pictures a player can pick for their profile. Shared by the server (which
// validates the choice) and the UI (which draws it from public/3d).

export const AVATARS = [
  "lion", "gelada", "cheetah", "owl", "fennec", "ibex",
  "giraffe", "elephant", "hippo", "hedgehog", "zebra", "parrot",
] as const;

export type AvatarName = (typeof AVATARS)[number];

export function isAvatar(v: unknown): v is AvatarName {
  return typeof v === "string" && (AVATARS as readonly string[]).includes(v);
}
