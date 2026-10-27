import { hashValue } from "./hash";
import type { MatchRecord } from "./types";

/** sha256 of the record's canonical JSON. */
export function resultHash(record: MatchRecord): string {
  return hashValue(record);
}
