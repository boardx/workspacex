import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import pg from "pg";
import { expect, it } from "vitest";
import { ensureDatabaseExists, startPgliteServer } from "../src/pglite-server";

it("reports the OS-bound port so an isolated listener is actually reachable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wsx-ephemeral-"));
  try {
    await ensureDatabaseExists(dir);
    const h = await startPgliteServer({ dataDir: dir, port: 0, username: "postgres" });
    try {
      expect(h.port).toBeGreaterThan(0);
      const c = new pg.Client({ host: "127.0.0.1", port: h.port, user: "postgres", database: "workspacex" });
      try {
        await c.connect();
        expect((await c.query("SELECT 37::int AS n")).rows).toEqual([{ n: 37 }]);
      } finally { await c.end(); }
    } finally { await h.stop(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("refuses an occupied explicit port without touching its unrelated owner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wsx-foreign-port-"));
  const foreign = net.createServer(s => s.end("unrelated-owner\n"));
  try {
    await new Promise<void>((resolve, reject) => {
      foreign.once("error", reject);
      foreign.listen(0, "127.0.0.1", resolve);
    });
    const port = (foreign.address() as net.AddressInfo).port;
    const dataDir = join(dir, "must-not-be-opened");
    await expect(startPgliteServer({ dataDir, port, username: "postgres" })).rejects.toThrow("already in use");
    expect(existsSync(dataDir)).toBe(false);
    expect(foreign.listening).toBe(true);
    const reply = await new Promise<string>((resolve, reject) => {
      let received = "";
      const c = net.connect(port, "127.0.0.1");
      c.on("data", data => { received += data.toString(); });
      c.once("error", reject);
      c.once("end", () => resolve(received));
    });
    expect(reply).toBe("unrelated-owner\n");
  } finally {
    await new Promise<void>((resolve, reject) => foreign.close(e => e ? reject(e) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
