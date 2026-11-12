import type { Socket } from "socket.io";

/** Profile IDs are EVM-style addresses: 0x + 40 lowercase hex. */
const PROFILE_ID = /^0x[0-9a-f]{40}$/;

/** A profile ID from a client message, lowercased, or "" when it isn't one. */
export function profileIdFrom(raw: unknown): string {
  const id = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return PROFILE_ID.test(id) ? id : "";
}

/**
 * Look up a key in a plain record without reaching the prototype. `record["__proto__"]`
 * is Object.prototype, not undefined, so a client-chosen key must go through here.
 */
export function own<T>(record: Record<string, T>, key: unknown): T | undefined {
  return typeof key === "string" && Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Make every handler registered on this socket fail on its own. A throw (or a rejected
 * promise) is logged and, when the client asked for an ack, answered with an error,
 * instead of reaching the process and taking every live match down with it.
 */
export function guardSocket(socket: Socket, log: (msg: string, err: unknown) => void = defaultLog): void {
  const on = socket.on.bind(socket);
  (socket as { on: Socket["on"] }).on = ((event: string, handler: (...args: unknown[]) => unknown) => {
    const safe = (...args: unknown[]) => {
      const ack = args.findLast((a) => typeof a === "function") as ((res: unknown) => void) | undefined;
      const fail = (err: unknown) => {
        log(`socket handler "${event}" failed for ${socket.data?.profileId ?? socket.id}`, err);
        try {
          ack?.({ ok: false, reason: "server error" });
        } catch {
          // The ack itself can't fail the process either.
        }
      };
      try {
        const out = handler(...args);
        if (out && typeof (out as Promise<unknown>).then === "function") (out as Promise<unknown>).catch(fail);
        return out;
      } catch (err) {
        fail(err);
      }
    };
    return on(event, safe);
  }) as Socket["on"];
}

function defaultLog(msg: string, err: unknown) {
  console.error(msg, err);
}

/** Keep the server up after a stray throw: log it, never exit (an exit refunds every live stake). */
export function installProcessGuards(log: (msg: string, err: unknown) => void = defaultLog): void {
  process.on("uncaughtException", (err) => log("uncaught exception (server kept running)", err));
  process.on("unhandledRejection", (err) => log("unhandled rejection (server kept running)", err));
}
