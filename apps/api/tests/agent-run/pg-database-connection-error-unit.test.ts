import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("pg", () => ({ default: { Pool: class extends EventEmitter {
  clients: Array<EventEmitter & {query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>}> = [];
  constructor() { super(); state.pool = this; }
  async connect() {
    const client = Object.assign(new EventEmitter(), {query: vi.fn(async () => ({rows: []})), release: vi.fn()});
    this.clients.push(client); this.emit("connect", client); return client;
  }
  async end() {}
} } }));
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import type { PgConfig } from "../../src/infrastructure/db/pg-config";
function setup() {
  const logger = {info: vi.fn(), error: vi.fn()};
  const db = new PgDatabase({} as PgConfig, logger);
  const pool = state.pool as EventEmitter & {clients: Array<EventEmitter & {query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>}>};
  return { db, pool, logger };
}
it("borrowed client error during non-SQL await fails without commit/replay and the next request succeeds", async () => {
  const {db, pool, logger} = setup();
  const error = Object.assign(new Error("secret SQL must not be logged"), {code: "57P01"});
  let unblock!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const gate = new Promise<void>(resolve => {unblock = resolve;});
  const action = vi.fn(async () => {entered(); await gate; return "must not succeed";});
  const pending = db.withoutTenant(action);
  await ready;
  expect(() => pool.clients[0]!.emit("error", error)).not.toThrow();
  unblock();
  await expect(pending).rejects.toBe(error);
  expect(action).toHaveBeenCalledTimes(1);
  expect(pool.clients[0]!.query.mock.calls.map(call => call[0])).not.toContain("COMMIT");
  expect(pool.clients[0]!.release).toHaveBeenCalledWith(error);
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret");
  await expect(db.withoutTenant(async () => "new request")).resolves.toBe("new request");
  expect(pool.clients).toHaveLength(2);
});
it("idle pool error is handled and does not prevent another connection", async () => {
  const {db, pool, logger} = setup();
  expect(() => pool.emit("error", Object.assign(new Error("terminated"), {code: "57P01"}))).not.toThrow();
  expect(logger.info).toHaveBeenCalledWith("database_connection_error", {traceId:"database",code:"57P01"});
  await expect(db.withoutTenant(async () => 1)).resolves.toBe(1);
});
it("a second teardown error cannot mask the first connection failure", async () => {
  const {db, pool} = setup();
  const first = new Error("first");
  await expect(db.withoutTenant(async () => {
    const client = pool.clients[0]!;
    client.emit("error", first);
    client.emit("error", new Error("second"));
    client.release.mockImplementation(() => {throw new Error("release");});
  })).rejects.toBe(first);
});
it("connection errors before BEGIN are observed before user work starts", async () => {
  const {db, pool} = setup();
  const checkout = pool as typeof pool & {connect: () => Promise<(typeof pool.clients)[number]>};
  const original = checkout.connect.bind(checkout);
  const error = new Error("disconnected before BEGIN");
  checkout.connect = async () => { const client = await original(); client.emit("error", error); return client; };
  const work = vi.fn();
  await expect(db.withoutTenant(work)).rejects.toBe(error);
  expect(work).not.toHaveBeenCalled();
  expect(pool.clients[0]!.query.mock.calls.map(call => call[0])).not.toContain("BEGIN");
});
