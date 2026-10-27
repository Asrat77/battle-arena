import { sha256 } from "@noble/hashes/sha2";
import { utf8ToBytes } from "@noble/hashes/utils";
import type { Rng } from "./types";

/** Seeded PRNG (sfc32) keyed by sha256 of the seed string. */
export function createRng(seed: string): Rng {
  const h = sha256(utf8ToBytes(seed));
  const word = (i: number) =>
    ((h[i] << 24) | (h[i + 1] << 16) | (h[i + 2] << 8) | h[i + 3]) >>> 0;
  let a = word(0);
  let b = word(4);
  let c = word(8);
  let d = word(12);

  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  // Warm up so similar seeds diverge.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    int(n) {
      if (!Number.isInteger(n) || n <= 0) throw new RangeError(`rng.int: bad bound ${n}`);
      return Math.floor(next() * n);
    },
    pick(items) {
      if (items.length === 0) throw new RangeError("rng.pick: empty list");
      return items[Math.floor(next() * items.length)];
    },
  };
}

/** The rng a system entry at log index `index` gets. Server and replay must both use this. */
export function rngForEntry(seed: string, index: number): Rng {
  return createRng(`${seed}#${index}`);
}
