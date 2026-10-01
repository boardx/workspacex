/**
 * 子进程台账（#3872 R21）——用真进程，不用替身：要证的正是「真孤儿被收掉、别人的进程不被误杀」。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLedger, reapLedger, recordChild, startedAt } from "../src/child-ledger";

const posix = process.platform !== "win32";

/** 起一个脱离父进程组、会把自己改名成 next-server 的孤儿候选（next 起来后正是这样）。 */
function orphanLikeNext(): number {
  const child = spawn(process.execPath, ["-e", "process.title='next-server (v14.2.15)'; setInterval(()=>{}, 1000)"], {
    detached: true, stdio: "ignore",
  });
  child.unref();
  return child.pid!;
}

async function waitUntil(pred: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

describe.skipIf(!posix)("child ledger", () => {
  it("收掉台账里还活着的孤儿——即使它已经把进程名改成了 next-server", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "ledger-")), "run", "children.json");
    const pid = orphanLikeNext();
    await waitUntil(() => startedAt(pid) !== null);
    recordChild(file, { name: "web", pid, started: startedAt(pid)! });

    const reaped = await reapLedger(file);

    expect(reaped).toEqual(["web"]);
    await waitUntil(() => startedAt(pid) === null);
    expect(startedAt(pid)).toBeNull();
    expect(readLedger(file)).toEqual([]);   // 收完清账，下次不会再对同一个 PID 动手
  });

  it("启动时刻对不上（PID 已被别的程序复用）就不碰", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "ledger-")), "children.json");
    const pid = orphanLikeNext();
    await waitUntil(() => startedAt(pid) !== null);
    try {
      recordChild(file, { name: "web", pid, started: "Thu Jan  1 00:00:00 1970" });

      const reaped = await reapLedger(file);

      expect(reaped).toEqual([]);
      expect(startedAt(pid)).not.toBeNull();   // 活着——正面对照：上一条用例证明了同样的进程是能被收掉的
    } finally {
      process.kill(-pid, "SIGKILL");
    }
  });

  it("台账写坏了不挡启动，当作空的", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "ledger-")), "children.json");
    writeFileSync(file, "{ half-written");
    expect(readLedger(file)).toEqual([]);
    expect(await reapLedger(file)).toEqual([]);
  });

  it("记同一个 PID 两次只留最新那条", () => {
    const file = join(mkdtempSync(join(tmpdir(), "ledger-")), "children.json");
    recordChild(file, { name: "api", pid: 4242, started: "a" });
    recordChild(file, { name: "api", pid: 4242, started: "b" });
    expect(readLedger(file)).toEqual([{ name: "api", pid: 4242, started: "b" }]);
  });
});
