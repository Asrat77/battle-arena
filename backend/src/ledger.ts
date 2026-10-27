import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Router } from "express";
import { type Block, type BlockKind, GENESIS_PREV_HASH, sealBlock } from "../../engine/ledger";
import type { Store } from "./store";

const BLOCKS = "ledger";
const SERVER_KEY = "ledgerKey";

interface PendingEntry {
  kind: BlockKind;
  payload: unknown;
  resolve: (block: Block) => void;
}

export interface LedgerOptions {
  blockTimeMs?: number;
  now?: () => number;
  // Hex secp256k1 key. Falls back to LEDGER_PRIVATE_KEY, then to a key
  // generated once and kept in the store.
  privateKey?: string;
}

// Simulated chain: append() queues an entry as pending, and every block time
// the queue is sealed into signed, hash-linked blocks.
export class Ledger {
  readonly publicKey: string;
  private readonly privateKey: string;
  private readonly blockTimeMs: number;
  private readonly now: () => number;
  private queue: PendingEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: Store,
    options: LedgerOptions = {},
  ) {
    this.blockTimeMs = options.blockTimeMs ?? 2000;
    this.now = options.now ?? Date.now;
    this.privateKey = options.privateKey ?? process.env.LEDGER_PRIVATE_KEY ?? this.storedKey();
    this.publicKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(this.privateKey)));
  }

  private storedKey(): string {
    let key = this.store.read<string | null>(SERVER_KEY, null);
    if (!key) {
      key = bytesToHex(secp256k1.utils.randomPrivateKey());
      this.store.write(SERVER_KEY, key);
    }
    return key;
  }

  blocks(): Block[] {
    return this.store.read<Block[]>(BLOCKS, []);
  }

  get(index: number): Block | null {
    return this.blocks()[index] ?? null;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  // Resolves with the sealed block once it is recorded.
  append(kind: BlockKind, payload: unknown): Promise<Block> {
    return new Promise((resolve) => {
      this.queue.push({ kind, payload, resolve });
      this.timer ??= setTimeout(() => this.flush(), this.blockTimeMs);
    });
  }

  // Seals everything pending right now.
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const entries = this.queue;
    this.queue = [];
    if (!entries.length) return;

    const chain = [...this.blocks()];
    const sealed = entries.map(({ kind, payload }) => {
      const prev = chain[chain.length - 1];
      const block = sealBlock(
        { index: chain.length, prevHash: prev ? prev.hash : GENESIS_PREV_HASH, ts: this.now(), kind, payload },
        this.privateKey,
      );
      chain.push(block);
      return block;
    });
    this.store.write(BLOCKS, chain);
    entries.forEach((entry, i) => entry.resolve(sealed[i]));
  }
}

export function ledgerRoutes(ledger: Ledger): Router {
  const router = Router();

  router.get("/api/ledger", (_req, res) => {
    res.json({ publicKey: ledger.publicKey, pending: ledger.pendingCount(), blocks: ledger.blocks() });
  });

  router.get("/api/ledger/:index", (req, res) => {
    const block = ledger.get(Number(req.params.index));
    if (!block) {
      res.status(404).json({ error: "block not found" });
      return;
    }
    res.json(block);
  });

  return router;
}
