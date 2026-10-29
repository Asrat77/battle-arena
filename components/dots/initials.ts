/** Short labels remain distinct even when players share a name. */
export function playerInitials(names: [string, string]): [string, string] {
  const letters = names.map((name) => Array.from(name.trim().replace(/\s+/gu, "").toLocaleUpperCase()));
  const first = letters.map((name) => name[0] ?? "?");
  if (first[0] !== first[1]) return [first[0], first[1]];
  const two = letters.map((name) => name.slice(0, 2).join("") || "?");
  return two[0] !== two[1] ? [two[0], two[1]] : [`${two[0]}1`, `${two[1]}2`];
}
