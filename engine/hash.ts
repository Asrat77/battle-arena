import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonical } from "./canonical";

/** sha256 of a UTF-8 string, lowercase hex. */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

/** sha256 of a value's canonical JSON. */
export function hashValue(value: unknown): string {
  return sha256Hex(canonical(value));
}
