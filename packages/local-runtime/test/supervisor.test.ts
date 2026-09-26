/**
 * 真起进程、真杀掉、真看它有没有被拉起来。
 * 不用替身——「挂了会不会被拉起」这件事，替身产不出缺陷的形状。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { superviseManaged, type ServiceHealth } from "../src/supervisor";

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "wsx-sup-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** 一个活着不退出的子进程。 */
const alive = (name: string) => ({
  name, command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: tmp(), env: {},
});
/** 一个立刻退出的子进程。 */
const dies = (name: string) => ({
  name, command: process.execPath, args: ["-e", "process.stdout.write('boom\\n');process.exit(1)"], cwd: tmp(), env: {},
});

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

describe("有人盯着的子进程", () => {
  it("活着的时候是 running", async () => {
    const s = superviseManaged({ spec: alive("api"), log: () => {} });
    await settle(150);
    expect(s.health().state).toBe("running");
    await s.stop();
  });

  it("被杀掉之后真的会被拉起来，而且换了一个新进程", async () => {
    const seen: ServiceHealth[] = [];
    const s = superviseManaged({
      spec: alive("api"), log: () => {}, onHealth: (h) => seen.push(h),
      schedule: (fn) => { setTimeout(fn, 5); },     // 测试里不等退避
    });
    await settle(150);
    const firstPid = s.current().child.pid;
    s.current().child.kill("SIGKILL");
    await settle(400);
    expect(seen.map((h) => h.state)).toContain("restarting");
    expect(s.health().state).toBe("running");
    expect(s.current().child.pid).not.toBe(firstPid);
    await s.stop();
  });

  it("一直起不来就停手，并给出说人话的说明", async () => {
    const s = superviseManaged({
      spec: dies("deep-agent"), log: () => {},
      schedule: (fn) => { setTimeout(fn, 5); },
    });
    await settle(600);
    expect(s.health().state).toBe("failed");
    const m = s.health().message;
    expect(m).not.toBeNull();
    expect(m!.title).toContain("智能体运行时");
    expect(m!.body).toContain("不会有回复");
    expect(`${m!.title}${m!.body}`).not.toMatch(/exit code|ECONNREFUSED|undefined/i);
    await s.stop();
  });

  it("崩溃现场写进日志——只说「退出了」是不可行动的", async () => {
    const lines: string[] = [];
    const s = superviseManaged({
      spec: dies("api"), log: (l) => lines.push(l), schedule: (fn) => { setTimeout(fn, 5); },
    });
    await settle(600);
    // ⚠ 不能只断言「日志里出现过 boom」：`startManaged` 本来就把子进程的每一行都转出来了，
    // 那条断言不改代码也成立（实测：把 recentOutput() 整段删掉，测试照绿）。
    // 要钉的是**监督者那一条**——「意外退出」和崩溃现场必须在同一行里一起出现。
    const crashLine = lines.find((l) => l.includes("意外退出"));
    expect(crashLine, "没有一条写着「意外退出」的日志").toBeTruthy();
    expect(crashLine!).toContain("boom");
    await s.stop();
  });

  it("我们自己停它的时候不当成崩溃，也不去重启", async () => {
    const seen: ServiceHealth[] = [];
    const s = superviseManaged({ spec: alive("api"), log: () => {}, onHealth: (h) => seen.push(h) });
    await settle(150);
    await s.stop();
    await settle(250);
    expect(seen.map((h) => h.state)).not.toContain("restarting");
  });
});
