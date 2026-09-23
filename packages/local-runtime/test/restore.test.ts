import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup } from "../src/backup";
import { replacedDirName, restoreBackup } from "../src/restore";

let root: string;
let srcObjects: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wsx-restore-"));
  srcObjects = join(root, "src-objects");
  await mkdir(srcObjects, { recursive: true });
  await writeFile(join(srcObjects, "note.txt"), "上传的文件");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const DUMP = new Uint8Array([7, 7, 7, 7, 7]);
const COUNTS: Record<string, number> = { organizations: 1, projects: 3, chat_threads: 12 };

/** 做一份真的备份，后面的恢复都从它读。 */
async function makeBackup(): Promise<string> {
  const r = await createBackup({
    destRoot: join(root, "backups"),
    appVersion: "0.2.0",
    dumpDatabase: async () => DUMP,
    countRows: async (t) => COUNTS[t] ?? null,
    objectsDir: srcObjects,
    now: new Date("2026-09-23T10:00:00Z"),
  });
  if (!r.ok) throw new Error(r.reason);
  return r.dir;
}

/** 恢复到的目标数据目录，预置一些「现有数据」。 */
async function makeDataDir(withExisting: boolean): Promise<string> {
  const d = join(root, "data");
  await mkdir(join(d, "pgdata"), { recursive: true });
  if (withExisting) await writeFile(join(d, "pgdata", "existing.bin"), "我现在的数据");
  return d;
}

const opts = (backupDir: string, dataDir: string, over: Partial<Parameters<typeof restoreBackup>[0]> = {}) => ({
  backupDir,
  dataDir,
  writeDatabase: async (pgDataDir: string, dump: Uint8Array) => {
    await mkdir(pgDataDir, { recursive: true });
    await writeFile(join(pgDataDir, "restored.bin"), dump);
  },
  countRows: async (t: string) => COUNTS[t] ?? null,
  now: new Date("2026-09-23T11:22:33"),
  ...over,
});

describe("挪走而不是删掉", () => {
  it("名字带时间戳，两次恢复不会互相覆盖", () => {
    const a = replacedDirName("/x/pgdata", new Date("2026-09-23T11:22:33"));
    const b = replacedDirName("/x/pgdata", new Date("2026-09-23T11:22:34"));
    expect(a).not.toBe(b);
    expect(a).toMatch(/pgdata\.replaced-\d{8}-\d{6}$/);
  });
});

describe("恢复一份备份", () => {
  it("读回数据库与上传的文件，并逐张表核对行数", async () => {
    const b = await makeBackup();
    const d = await makeDataDir(false);
    const r = await restoreBackup(opts(b, d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await readFile(join(d, "pgdata", "restored.bin"))).toEqual(Buffer.from(DUMP));
    expect(await readFile(join(d, "objects", "note.txt"), "utf8")).toBe("上传的文件");
    expect(r.verified.chat_threads).toEqual({ expected: 12, actual: 12 });
  });

  it("**现有数据被挪走，不是被删掉**，而且告诉你挪到了哪", async () => {
    const b = await makeBackup();
    const d = await makeDataDir(true);
    const r = await restoreBackup(opts(b, d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.movedAsideTo).not.toBeNull();
    // 原来那份数据必须还在磁盘上
    expect(await readFile(join(r.movedAsideTo!, "existing.bin"), "utf8")).toBe("我现在的数据");
  });

  it("目标是空的就不做无谓的挪移", async () => {
    const b = await makeBackup();
    const d = await makeDataDir(false);
    const r = await restoreBackup(opts(b, d));
    expect(r.ok && r.movedAsideTo).toBeNull();
  });
});

describe("先验后写", () => {
  it("备份被改过就根本不开始，现有数据一动不动", async () => {
    const b = await makeBackup();
    await writeFile(join(b, "objects/note.txt"), "被改过了");   // 同长度，只改内容
    const d = await makeDataDir(true);
    const r = await restoreBackup(opts(b, d));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("没有动你现在的数据");
    // 现有数据还在原处，没有被挪走
    expect(await readFile(join(d, "pgdata", "existing.bin"), "utf8")).toBe("我现在的数据");
    expect((await readdir(d)).filter((n) => n.includes("replaced"))).toEqual([]);
  });

  it("不认得的格式版本就拒绝，而不是尽力而为", async () => {
    const b = await makeBackup();
    const m = JSON.parse(await readFile(join(b, "manifest.json"), "utf8")) as Record<string, unknown>;
    m.formatVersion = 999;
    await writeFile(join(b, "manifest.json"), JSON.stringify(m));
    const r = await restoreBackup(opts(b, await makeDataDir(true)));
    expect(r.ok).toBe(false);
  });
});

describe("恢复完要数行数", () => {
  it("读回来的行数和清单对不上就判失败，并说清原数据在哪", async () => {
    const b = await makeBackup();
    const d = await makeDataDir(true);
    const r = await restoreBackup(opts(b, d, {
      countRows: async (t: string) => (t === "chat_threads" ? 2 : COUNTS[t] ?? null),  // 少了 10 条
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("chat_threads");
      expect(r.reason).toMatch(/没有被删除/);
    }
  });

  it("表读不到也算对不上——「读不到」不等于「0 条」", async () => {
    const b = await makeBackup();
    const r = await restoreBackup(opts(b, await makeDataDir(false), { countRows: async () => null }));
    expect(r.ok).toBe(false);
  });
});
