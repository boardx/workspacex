/**
 * 14 次真实启动失败，每一条都要有按钮（#3872 R10）。
 *
 * 判据取自这台机器上安装版自己的 `desktop.log`——**用它当时真的打印的那几句原文**
 * 当输入，不是我改写过的形状（改写过的输入只能证明我的正则匹配我自己的例子）。
 */
import { describe, expect, it } from "vitest";
import { diagnoseStartupFailure, PortsInUseError, takenPortsOf } from "../src/startup-failure";
import { assertPortsFreeForTest } from "../src/up";

/** desktop.log 里逐字复制的原文（2026-09-20 / 09-19 / 09-22）。 */
const REAL = {
  portTaken:
    "127.0.0.1:55432 (PostgreSQL) is already in use -- another WorkspaceX Local or a leftover "
    + "PostgreSQL process is running; stop it first (lsof -ti :55432 | xargs kill)",
  sandboxTaken:
    "127.0.0.1:3310 (skill-sandbox) is already in use -- another WorkspaceX Local or a leftover "
    + "skill-sandbox process is running; stop it first (lsof -ti :3310 | xargs kill)",
  hardKill:
    "PGlite could not open /Users/x/Library/Application Support/WorkspaceX/local/pgdata: it is "
    + "either open in another process or was left inconsistent by a hard kill. If no other "
    + "WorkspaceX Local is running, move the directory aside (it is rebuilt from migrations + "
    + "seeds) and start again.",
};

describe("端口被上次的自己占着（实测 8 次）", () => {
  it("给出「收回并重试」，并带上那个端口", () => {
    const d = diagnoseStartupFailure(new Error(REAL.portTaken), { hasBackup: false });
    expect(d.unknown).toBe(false);
    expect(d.remedies[0]).toEqual({ kind: "reclaim-port", ports: [55432], label: "收回并重试" });
  });

  it("端口号换了也认，且说的是那个服务对用户的名字", () => {
    const d = diagnoseStartupFailure(new Error(REAL.sandboxTaken), { hasBackup: false });
    expect(d.remedies[0]).toMatchObject({ kind: "reclaim-port", ports: [3310] });
    expect(d.body).toContain("技能沙箱");
    expect(d.body).not.toContain("skill-sandbox");   // 内部名不许漏给用户
  });

  it("不许把 shell 命令甩给用户", () => {
    const d = diagnoseStartupFailure(new Error(REAL.portTaken), { hasBackup: false });
    expect(`${d.title}${d.body}`).not.toMatch(/lsof|xargs|kill/);
  });
});

describe("上次被硬杀、数据库打不开（实测 6 次）", () => {
  it("有备份时首推恢复", () => {
    const d = diagnoseStartupFailure(new Error(REAL.hardKill), { hasBackup: true });
    expect(d.remedies.map((r) => r.kind)).toEqual(["restore-backup", "move-aside"]);
  });

  it("没备份时仍然有一条出路，不是死路", () => {
    const d = diagnoseStartupFailure(new Error(REAL.hardKill), { hasBackup: false });
    expect(d.remedies.map((r) => r.kind)).toEqual(["move-aside"]);
  });

  it("**不许再说「由迁移和种子重建」**——那是叫用户丢掉自己的数据", () => {
    for (const hasBackup of [true, false]) {
      const d = diagnoseStartupFailure(new Error(REAL.hardKill), { hasBackup });
      expect(`${d.title}${d.body}`).not.toMatch(/重建|迁移|种子|rebuilt|seeds/);
      expect(d.body).toContain("不会被删除");      // 必须明说旧数据的下落
    }
  });
});

describe("不认识的错误", () => {
  it("如实说不认识，不编一个按钮出来", () => {
    const d = diagnoseStartupFailure(new Error("EACCES: permission denied, mkdir '/nope'"), { hasBackup: true });
    expect(d.unknown).toBe(true);
    expect(d.remedies).toEqual([]);
  });
});

/**
 * ⚠ **这一节是上面那些「逐字复制的原文」翻车之后补的。**
 *
 * R10 我从历史日志里抄了 `127.0.0.1:55432 (PostgreSQL) is already in use` 当夹具，
 * 测试全绿——而 `up.ts` 早就改成了中文多端口消息，于是「收回并重试」这个按钮
 * 在它真正要处理的那条路上**从来没出现过**。夹具忠实地复现了一份**过期的现实**。
 *
 * 所以这一节不再手抄任何字符串：**让产线代码自己抛，再拿它去分诊**。
 * 文案怎么改都行，这条门盯的是「抛出来的东西分诊认不认得」。
 */
describe("拿产线代码真的抛出来的错去分诊", () => {
  it("端口被占时，分诊认得出来并给出「收回并重试」", async () => {
    const thrown = await assertPortsFreeForTest({ postgres: 1, api: 2, sandbox: 3, web: 4 }, () => true);
    expect(thrown, "assertPortsFree 应该在端口全被占时抛错").not.toBeNull();
    expect(thrown).toBeInstanceOf(PortsInUseError);

    const d = diagnoseStartupFailure(thrown, { hasBackup: false });
    expect(d.unknown, `分诊没认出产线抛的错：${String((thrown as Error).message).slice(0, 60)}`).toBe(false);
    expect(d.remedies[0]?.kind).toBe("reclaim-port");
    expect(takenPortsOf(thrown)).toEqual([1, 2, 3, 4]);
  });

  it("**即使只剩文案也要认**——旧版本写下的日志、别处抛的错，没有结构化事实", () => {
    const thrown = new Error("以下端口已被占用，无法启动：\n  55432  PostgreSQL (PGlite)\n  3200  API\n多半是…");
    expect(takenPortsOf(thrown)).toEqual([55432, 3200]);
    expect(diagnoseStartupFailure(thrown, { hasBackup: false }).unknown).toBe(false);
  });
});
