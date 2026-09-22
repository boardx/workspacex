import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { SessionAwareQueryQueue } from "../src/pglite-queue";

// Frontend message builders (type + int32 length incl. itself + body).
const enc = new TextEncoder();
const cstr = (s: string) => enc.encode(`${s}\0`);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
function fe(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + body.length);
  out[0] = type.charCodeAt(0);
  new DataView(out.buffer).setInt32(1, 4 + body.length);
  out.set(body, 5);
  return out;
}
const i16 = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
const i32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const parse = (stmt: string, sql: string) => fe("P", cat(cstr(stmt), cstr(sql), i16(0)));
const bind = (portal: string, stmt: string, params: string[]) =>
  fe("B", cat(cstr(portal), cstr(stmt), i16(0), i16(params.length), ...params.map((p) => cat(i32(p.length), enc.encode(p))), i16(0)));
const describe_ = (kind: "S" | "P", name: string) => fe("D", cat(enc.encode(kind), cstr(name)));
const execute = (portal: string) => fe("E", cat(cstr(portal), i32(0)));
const sync = () => fe("S", new Uint8Array(0));
const query = (sql: string) => fe("Q", cstr(sql));

/** Collect backend messages types for one frontend message; throw on ErrorResponse. */
function decodeTypes(chunks: Uint8Array[]): { types: string[]; error?: string } {
  const buf = cat(...chunks);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const types: string[] = [];
  let error: string | undefined;
  let i = 0;
  while (i + 5 <= buf.length) {
    const t = String.fromCharCode(buf[i]!);
    const len = view.getInt32(i + 1);
    if (t === "E") error = new TextDecoder().decode(buf.subarray(i + 5, i + 1 + len)).replace(/\0/g, " ");
    types.push(t);
    i += 1 + len;
  }
  return { types, error };
}

async function send(q: SessionAwareQueryQueue, handler: number, msg: Uint8Array) {
  const chunks: Uint8Array[] = [];
  await q.enqueue(handler, msg, (c) => chunks.push(c));
  return decodeTypes(chunks);
}

describe("SessionAwareQueryQueue ownership across an extended-protocol exchange", () => {
  it("keeps the unnamed portal alive when another client's Query is queued between Bind and Execute (psycopg shape)", async () => {
    const db = await PGlite.create();
    await db.exec("create table t(id text primary key)");
    const q = new SessionAwareQueryQueue(db);
    const PSYCOPG = 1;
    const PG_NODE = 2;
    const sql = "INSERT INTO t(id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id";
    // round trip 1: Parse + Describe(S) + Sync, one message per enqueue like PGLiteSocketHandler does
    for (const m of [parse("", sql), describe_("S", ""), sync()]) {
      const r = await send(q, PSYCOPG, m);
      expect(r.error, `round trip 1: ${r.types.join("")}`).toBeUndefined();
    }
    // round trip 2: Bind, then another client's simple Query arrives while psycopg's Execute has not been enqueued yet
    const b = await send(q, PSYCOPG, bind("", "", ["x1"]));
    expect(b.error).toBeUndefined();
    const other = send(q, PG_NODE, query("select 1"));
    await new Promise((r) => setTimeout(r, 20)); // let the queue consider the other client's message
    const d = await send(q, PSYCOPG, describe_("P", ""));
    const e = await send(q, PSYCOPG, execute(""));
    const s = await send(q, PSYCOPG, sync());
    await other;
    expect(d.error).toBeUndefined();
    expect(e.error, `execute: ${e.types.join("")}`).toBeUndefined();
    expect(s.types).toContain("Z");
    const rows = await db.query<{ id: string }>("select id from t");
    expect(rows.rows.map((r) => r.id)).toEqual(["x1"]);
  });

  it("releases the backend after Sync so the other client is not starved", async () => {
    const db = await PGlite.create();
    const q = new SessionAwareQueryQueue(db);
    await send(q, 1, query("select 1"));
    const r = await send(q, 2, query("select 2"));
    expect(r.error).toBeUndefined();
    expect(r.types).toContain("Z");
  });
});

describe("SessionAwareQueryQueue ReadyForQuery detection on chunked output", () => {
  it("releases the backend promptly after a large result set that PGlite streams in several chunks", async () => {
    const db = await PGlite.create();
    const q = new SessionAwareQueryQueue(db);
    // ~1 MB of output -> many raw chunks; the ReadyForQuery must be found even when a chunk boundary splits a message
    const big = await send(q, 1, query("select repeat('x', 4096) as s from generate_series(1, 256)"));
    expect(big.error).toBeUndefined();
    const t0 = Date.now();
    const other = await send(q, 2, query("select 1"));
    expect(other.error).toBeUndefined();
    expect(other.types).toContain("Z");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("SessionAwareQueryQueue and Terminate", () => {
  it("releases the backend when a client sends Terminate (pg-pool reaping an idle connection)", async () => {
    const db = await PGlite.create();
    const q = new SessionAwareQueryQueue(db);
    await send(q, 1, query("select 1"));
    await send(q, 1, fe("X", new Uint8Array(0)));
    const t0 = Date.now();
    const r = await send(q, 2, query("select 2"));
    expect(r.error).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("SessionAwareQueryQueue and Flush", () => {
  it("a lone Flush after a completed exchange does not hold the backend (psycopg after COMMIT)", async () => {
    const db = await PGlite.create();
    const q = new SessionAwareQueryQueue(db);
    await send(q, 1, query("select 1"));
    await send(q, 1, fe("H", new Uint8Array(0)));
    const t0 = Date.now();
    const r = await send(q, 2, query("select 2"));
    expect(r.error).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("a Flush in the middle of an extended exchange still keeps ownership until Sync", async () => {
    const db = await PGlite.create();
    await db.exec("create table t(id text primary key)");
    const q = new SessionAwareQueryQueue(db);
    const sql = "INSERT INTO t(id) VALUES ($1) RETURNING id";
    await send(q, 1, parse("", sql));
    await send(q, 1, bind("", "", ["f1"]));
    await send(q, 1, fe("H", new Uint8Array(0)));
    const other = send(q, 2, query("select 1"));
    await new Promise((r) => setTimeout(r, 20));
    const e = await send(q, 1, execute(""));
    const s = await send(q, 1, sync());
    await other;
    expect(e.error).toBeUndefined();
    expect(s.types).toContain("Z");
  });
});
