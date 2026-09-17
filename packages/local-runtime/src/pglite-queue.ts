/**
 * A session-aware query queue for pglite-socket.
 *
 * ## The bug this replaces
 *
 * pglite-socket's built-in QueryQueueManager enqueues every frontend protocol MESSAGE as a
 * separate unit and only keeps a client "sticky" while PGlite reports an open transaction.
 * PGlite has exactly one backend session, so anything that is per-session in PostgreSQL --
 * the unnamed prepared statement, named prepared statements, portals -- is shared between
 * all TCP clients. psycopg (the deep-agent service) talks in two round trips: Parse+Describe+
 * Sync, then Bind+Execute+Sync. Between those, another client's Parse replaces the unnamed
 * statement and the second round trip fails with "unnamed prepared statement does not
 * exist" (Mac实测, issue #3716). Named statements collide the same way ("_pg3_0" exists).
 *
 * ## What this does instead
 *
 *   1. Ownership: the first message from a client claims the backend; other clients' messages
 *      wait. Ownership is released when the backend has answered with ReadyForQuery ('Z')
 *      AND the client is not in the middle of an extended-protocol exchange: an unnamed
 *      Parse ('P' with empty name) keeps ownership until a Bind ('B') from the same client,
 *      so the two-round-trip pattern is safe. A client that goes quiet while owning the
 *      backend loses it after `ownerIdleMs` (a bug guard, not a normal path).
 *   2. Namespacing: named prepared statements and named portals are rewritten per client
 *      (`h<id>.<name>`) in Parse, Bind, Describe, Close and Execute, so two connections that
 *      both prepare "_pg3_0" no longer collide. Names are opaque to clients, so this is
 *      invisible to them. Unnamed ("") stays unnamed: its lifetime semantics matter.
 *   3. Transactions: while PGlite reports an open transaction, only the owner runs (as before).
 *
 * The class implements the same duck-typed surface pglite-socket's handlers call
 * (`enqueue`, `clearQueueForHandler`, `clearTransactionIfNeeded`, `getQueueLength`), and is
 * installed by replacing `server.queryQueue` before `start()`.
 */
import type { PGlite } from "@electric-sql/pglite";

interface QueueItem {
  readonly handlerId: number;
  readonly message: Uint8Array;
  readonly onData: (chunk: Uint8Array) => void;
  readonly resolve: (bytes: number) => void;
  readonly reject: (e: unknown) => void;
}

const READY_FOR_QUERY = 0x5a; // 'Z'

export class SessionAwareQueryQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private owner: number | null = null;
  private ownerSince = 0;
  /** handler id → an unnamed Parse was sent and no Bind has followed yet */
  private pendingUnnamedParse = new Set<number>();
  /** the last chunk of backend output for the in-flight message, to detect ReadyForQuery */
  constructor(private readonly db: PGlite, private readonly ownerIdleMs = 5_000) {}

  enqueue(handlerId: number, message: Uint8Array, onData: (chunk: Uint8Array) => void): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.queue.push({ handlerId, message: rewriteNames(handlerId, message), onData, resolve, reject });
      if (!this.processing) void this.processQueue();
    });
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  clearQueueForHandler(handlerId: number): void {
    this.queue = this.queue.filter((item) => {
      if (item.handlerId !== handlerId) return true;
      item.reject(new Error("Handler disconnected"));
      return false;
    });
    this.pendingUnnamedParse.delete(handlerId);
    if (this.owner === handlerId) this.owner = null;
    if (!this.processing) void this.processQueue();
  }

  async clearTransactionIfNeeded(handlerId: number): Promise<void> {
    if (this.db.isInTransaction() && this.owner === handlerId) {
      await this.db.exec("ROLLBACK");
    }
    if (this.owner === handlerId) this.owner = null;
    if (!this.processing) void this.processQueue();
  }

  private pickNext(): QueueItem | null {
    if (this.queue.length === 0) return null;
    if (this.owner !== null) {
      const i = this.queue.findIndex((q) => q.handlerId === this.owner);
      if (i >= 0) return this.queue.splice(i, 1)[0]!;
      // Owner has nothing queued. If it is mid-exchange, wait for it (bounded); otherwise release.
      const midExchange = this.pendingUnnamedParse.has(this.owner) || this.db.isInTransaction();
      if (midExchange && Date.now() - this.ownerSince < this.ownerIdleMs) return null;
      this.owner = null;
    }
    const next = this.queue.shift()!;
    this.owner = next.handlerId;
    this.ownerSince = Date.now();
    return next;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (;;) {
        const item = this.pickNext();
        if (!item) {
          // an owner is mid-exchange with nothing queued: poll briefly for its next message
          if (this.owner !== null && this.queue.length > 0) { await sleep(2); continue; }
          break;
        }
        const type = item.message[0];
        if (type === 0x50 /* P */ && parseStatementName(item.message) === "") this.pendingUnnamedParse.add(item.handlerId);
        if (type === 0x42 /* B */ || type === 0x51 /* Q */) this.pendingUnnamedParse.delete(item.handlerId);
        let bytes = 0;
        let sawReady = false;
        try {
          await this.db.runExclusive(async () => {
            await this.db.execProtocolRawStream(item.message, {
              onRawData: (chunk: Uint8Array) => {
                bytes += chunk.length;
                if (endsWithReadyForQuery(chunk)) sawReady = true;
                item.onData(chunk);
              },
            });
          });
        } catch (e) {
          item.reject(e);
          if (this.owner === item.handlerId) this.owner = null;
          continue;
        }
        this.ownerSince = Date.now();
        item.resolve(bytes);
        if (sawReady && !this.pendingUnnamedParse.has(item.handlerId) && !this.db.isInTransaction()) {
          this.owner = null;
        }
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0) setTimeout(() => void this.processQueue(), 0);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Backend messages are `type(1) length(4, includes itself) body`; check the last one is 'Z'. */
function endsWithReadyForQuery(chunk: Uint8Array): boolean {
  let i = 0;
  let last = -1;
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  while (i + 5 <= chunk.length) {
    const len = view.getInt32(i + 1);
    if (len < 4 || i + 1 + len > chunk.length) break;
    last = chunk[i]!;
    i += 1 + len;
  }
  return last === READY_FOR_QUERY;
}

function cstrEnd(buf: Uint8Array, from: number): number {
  let i = from;
  while (i < buf.length && buf[i] !== 0) i += 1;
  return i;
}

function parseStatementName(msg: Uint8Array): string {
  // 'P' int32 len, then statement name cstring
  const end = cstrEnd(msg, 5);
  return new TextDecoder().decode(msg.subarray(5, end));
}

/**
 * Rewrite named statements/portals to a per-handler namespace. Layouts (after type+len):
 *   P: stmt\0 query\0 ...            B: portal\0 stmt\0 ...
 *   D: kind(1) name\0                C: kind(1) name\0
 *   E: portal\0 int32
 * Empty names are left alone.
 */
export function rewriteNames(handlerId: number, msg: Uint8Array): Uint8Array {
  const type = msg[0];
  const prefix = `h${handlerId}.`;
  const enc = new TextEncoder();
  const rename = (name: Uint8Array): Uint8Array => (name.length === 0 ? name : concat(enc.encode(prefix), name));
  let fields: { start: number; end: number }[] = [];
  if (type === 0x50 /* P */) {
    const e1 = cstrEnd(msg, 5);
    fields = [{ start: 5, end: e1 }];
  } else if (type === 0x42 /* B */) {
    const e1 = cstrEnd(msg, 5);
    const e2 = cstrEnd(msg, e1 + 1);
    fields = [{ start: 5, end: e1 }, { start: e1 + 1, end: e2 }];
  } else if (type === 0x44 /* D */ || type === 0x43 /* C */) {
    const e1 = cstrEnd(msg, 6);
    fields = [{ start: 6, end: e1 }];
  } else if (type === 0x45 /* E */) {
    const e1 = cstrEnd(msg, 5);
    fields = [{ start: 5, end: e1 }];
  } else {
    return msg;
  }
  if (fields.every((f) => f.end === f.start)) return msg;
  const parts: Uint8Array[] = [];
  let cursor = 5;
  if (type === 0x44 || type === 0x43) { parts.push(msg.subarray(0, 6)); cursor = 6; } else parts.push(msg.subarray(0, 5));
  for (const f of fields) {
    if (f.start > cursor) parts.push(msg.subarray(cursor, f.start));
    parts.push(rename(msg.subarray(f.start, f.end)));
    cursor = f.end;
  }
  parts.push(msg.subarray(cursor));
  const out = concat(...parts);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setInt32(1, out.length - 1);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
