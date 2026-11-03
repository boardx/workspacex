import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { expect, it, vi } from "vitest";
import * as pglite from "../src/pglite-server";
import { portInUse } from "../src/processes";
import { withDb } from "./fixtures/roundtrip-db";

it.each(["connect", "end", "callback"] as const)("releases only its own listener after %s fails", async (phase) => {
  const dir = mkdtempSync(join(tmpdir(), "wsx-rt-cleanup-"));
  const foreign = net.createServer(s => s.end("unrelated-owner\n"));
  await new Promise<void>((resolve, reject) => {
    foreign.once("error", reject);
    foreign.listen(0, "127.0.0.1", resolve);
  });
  const foreignPort = (foreign.address() as net.AddressInfo).port;
  const start = vi.spyOn(pglite, "startPgliteServer");
  const failure = new Error(`injected ${phase} failure`);
  if (phase === "connect") vi.spyOn(pg.Client.prototype, "connect").mockRejectedValueOnce(failure);
  if (phase === "end") {
    const end = pg.Client.prototype.end as (this: pg.Client) => Promise<void>;
    vi.spyOn(pg.Client.prototype, "end").mockImplementationOnce(async function (this: pg.Client) {
      await end.call(this);
      throw failure;
    });
  }
  let owned: pglite.PgliteHandle | undefined;
  try {
    await expect(withDb(dir, async () => {
      if (phase === "callback") throw failure;
      return 37;
    })).rejects.toBe(failure);
    owned = await start.mock.results[0]!.value as pglite.PgliteHandle;
    expect(owned.port).not.toBe(foreignPort);
    expect(await portInUse(owned.port)).toBe(false);
    expect(foreign.listening).toBe(true);
    expect(await portInUse(foreignPort)).toBe(true);
  } finally {
    // Test cleanup may touch only the handle and sentinel this test created.
    owned ??= await start.mock.results[0]?.value as pglite.PgliteHandle | undefined;
    await owned?.stop();
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => foreign.close(e => e ? reject(e) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
