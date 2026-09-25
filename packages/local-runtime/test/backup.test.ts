import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKUP_FORMAT_VERSION, backupDirName, collectFiles, createBackup, humanBytes, verifyBackup,
} from "../src/backup";

let root: string;
let objects: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wsx-backup-"));
  objects = join(root, "objects-src");
  await mkdir(join(objects, "a"), { recursive: true });
  await writeFile(join(objects, "a", "one.bin"), Buffer.from([1, 2, 3]));
  await writeFile(join(objects, "two.txt"), "hello");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const opts = (over: Partial<Parameters<typeof createBackup>[0]> = {}) => ({
  destRoot: join(root, "out"),
  appVersion: "0.2.0",
  dumpDatabase: async () => new Uint8Array([9, 9, 9, 9]),
  countRows: async (t: string) => (t === "agent_runs" ? null : 7),
  objectsDir: objects,
  now: new Date("2026-09-23T10:11:12Z"),
  ...over,
});

describe("备份目录名", () => {
  it("带时间戳，两次不同时刻不会互相覆盖", () => {
    const a = backupDirName(new Date("2026-09-23T10:11:12"));
    const b = backupDirName(new Date("2026-09-23T10:11:13"));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^workspacex-backup-\d{8}-\d{6}$/);
  });
});

describe("人话大小", () => {
  it("给人看的是 MB 不是字节数", () => {
    expect(humanBytes(398458880)).toBe("380 MB");
    expect(humanBytes(900)).toBe("900 B");
    expect(humanBytes(10 * 1024 ** 3)).toBe("10.0 GB");
  });
});

describe("收集文件", () => {
  it("递归拿到相对路径", async () => {
    expect([...(await collectFiles(objects))].sort()).toEqual(["a/one.bin", "two.txt"]);
  });
  it("目录不存在时返回空，不抛", async () => {
    expect(await collectFiles(join(root, "nope"))).toEqual([]);
  });
});

describe("做一次备份", () => {
  it("落盘、带清单、自校验通过", async () => {
    const r = await createBackup(opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(r.manifest.entries.map((e) => e.path).sort())
      .toEqual(["database.tar.gz", "objects/a/one.bin", "objects/two.txt"]);
    expect((await stat(join(r.dir, "database.tar.gz"))).size).toBe(4);
  });

  it("收据上是用户认得出来的东西，表不存在时不编一个 0", async () => {
    const r = await createBackup(opts());
    expect(r.ok && r.manifest.rowCounts.chat_messages).toBe(7);
    expect(r.ok && "agent_runs" in r.manifest.rowCounts).toBe(false);
  });

  it("明说没有包含什么", async () => {
    const r = await createBackup(opts());
    expect(r.ok && r.manifest.excluded.join("｜")).toMatch(/模型/);
  });

  it("取快照失败就说失败，不留一个看起来成功的备份", async () => {
    const r = await createBackup(opts({ dumpDatabase: async () => { throw new Error("库正忙"); } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("库正忙");
  });
});

describe("校验", () => {
  it("文件被改过就判失败", async () => {
    const r = await createBackup(opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await writeFile(join(r.dir, "objects/two.txt"), "hellp");   // 同长度，只改内容
    const v = await verifyBackup(r.dir);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/摘要对不上/);
  });

  it("文件被删了就判失败", async () => {
    const r = await createBackup(opts());
    if (!r.ok) return;
    await rm(join(r.dir, "objects/two.txt"));
    const v = await verifyBackup(r.dir);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/没有这个文件/);
  });

  it("长度被改过就判失败（不只看摘要）", async () => {
    const r = await createBackup(opts());
    if (!r.ok) return;
    await writeFile(join(r.dir, "objects/two.txt"), "hello world");
    const v = await verifyBackup(r.dir);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/大小对不上/);
  });

  it("不认得的格式版本要拒绝，而不是尽力而为", async () => {
    const r = await createBackup(opts());
    if (!r.ok) return;
    const m = JSON.parse(await readFile(join(r.dir, "manifest.json"), "utf8")) as Record<string, unknown>;
    m.formatVersion = 999;
    await writeFile(join(r.dir, "manifest.json"), JSON.stringify(m));
    const v = await verifyBackup(r.dir);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/格式版本/);
  });

  it("没有清单就判失败", async () => {
    const v = await verifyBackup(join(root, "empty"));
    expect(v.ok).toBe(false);
  });
});

describe("写与校验必须接上", () => {
  it("校验说不通过，备份就必须判失败——不能只是写完就说成功", async () => {
    const r = await createBackup(opts({
      verify: async () => ({ ok: false as const, reason: "探针：假装摘要对不上" }),
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("探针");
  });

  it("校验通过时照常成功", async () => {
    const r = await createBackup(opts());
    expect(r.ok).toBe(true);
  });
});
