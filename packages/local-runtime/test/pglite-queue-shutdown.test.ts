import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { SessionAwareQueryQueue } from "../src/pglite-queue";

function query(sql: string): Uint8Array {
  const body = new TextEncoder().encode(`${sql}\0`);
  const message = new Uint8Array(body.length + 5);
  message[0] = "Q".charCodeAt(0);
  new DataView(message.buffer).setInt32(1, body.length + 4);
  message.set(body, 5);
  return message;
}

it("drains active SQL before close and rejects waiting work during shutdown", async () => {
  const db = await PGlite.create();
  const queue = new SessionAwareQueryQueue(db);
  const active = queue.enqueue(1, query("select pg_sleep(0.02)"), () => {});
  const waiting = queue.enqueue(2, query("select 2"), () => {});
  const rejected = expect(waiting).rejects.toThrow(/stopping/);
  const stop = queue.stop();
  expect(queue.stop()).toBe(stop);
  await stop;
  await active;
  await rejected;
  await db.close();
  // Socket close/detach callbacks can arrive after the database is closed.
  await expect(queue.clearTransactionIfNeeded(1)).resolves.toBeUndefined();
  queue.clearQueueForHandler(2);
  await expect(queue.enqueue(3, query("select 3"), () => {})).rejects.toThrow(/stopping/);
});
