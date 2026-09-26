/**
 * 更新与回滚在桌面壳里的接线纪律（#3872 R20）。
 *
 * 判据不是「代码存在」——R10 的启动分诊就是代码存在但在真机上是死代码。
 * 这里钉的是**顺序与承诺**：先验再动、旧版必须保留、以及那三样换不了要说出口。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(join(__dirname, "..", "src", "main.ts"), "utf8");

/**
 * 「A 在 B 之前」——**先确认两者都存在**。
 *
 * ⚠ 直接写 `expect(b.indexOf(a)).toBeLessThan(b.indexOf(c))` 有个退化漏洞：
 *   a 不存在时 indexOf 返回 -1，而 -1 < 任何正数都成立，断言自动通过。
 *   2026-09-24 反证时实测：删掉「回滚也保留当前版本」那一行，10 条全绿。
 *   这和本仓抓过多次的「断言被退化情形满足」是同一族。
 */
function expectOrder(hay: string, first: string, second: string, why: string): void {
  const i = hay.indexOf(first);
  const j = hay.indexOf(second);
  expect(i, `${why}：找不到「${first}」`).toBeGreaterThan(-1);
  expect(j, `${why}：找不到「${second}」`).toBeGreaterThan(-1);
  expect(i, why).toBeLessThan(j);
}

function fn(name: string): string {
  const i = MAIN.indexOf(`async function ${name}(`);
  expect(i, `main.ts 里找不到 ${name}`).toBeGreaterThan(-1);
  const j = MAIN.indexOf("\nasync function ", i + 10);
  return MAIN.slice(i, j > 0 ? j : i + 4000);
}

describe("安装离线更新包", () => {
  const body = () => fn("runUpdate");

  it("**先 inspect，再 verify，最后才动文件**", () => {
    const b = body();
    expectOrder(b, "inspectUpdate(", "verifyUpdatePayload(", "必须先 inspect 再 verify");
    expectOrder(b, "verifyUpdatePayload(", "cpSync(", "写入必须在两道检查之后");
  });

  it("校验不过时**一个字节都不动**——不许出现写入路径", () => {
    const b = body();
    const bad = b.indexOf("if (!check.ok)");
    const write = b.indexOf("cpSync(");
    const between = b.slice(bad, write);
    expect(bad).toBeGreaterThan(-1);
    expect(between, "校验失败分支到写入之间不该有 return 之外的出路").toContain("return");
  });

  it("**装新版之前把当前版本挪走保留，不是覆盖**", () => {
    const b = body();
    expectOrder(b, "renameSync(BUNDLE_DIR(), keptAt)", "cpSync(", "装新版之前必须把当前版本挪走保留");
  });

  it("写失败时把旧的搬回来——不留半新半旧的 bundle", () => {
    const b = body();
    const catchPart = b.slice(b.indexOf("} catch (e) {"));
    expect(catchPart).toMatch(/renameSync\(keptAt, BUNDLE_DIR\(\)\)/);
  });

  it("**那三样换不了要说出口**，而且文案只写一处", () => {
    expect(MAIN).toContain("UPDATE_SCOPE_NOTE");
    const note = MAIN.slice(MAIN.indexOf("const UPDATE_SCOPE_NOTE"), MAIN.indexOf("const UPDATE_SCOPE_NOTE") + 400);
    expect(note).toMatch(/外壳/);
    expect(note).toMatch(/模型/);
    expect(note).toMatch(/Ollama/);
    expect(note).toMatch(/重新安装/);
    // 同一句话不许出现第二份副本（本仓头号病）
    expect(MAIN.split("离线更新换的是应用逻辑").length - 1, "这句话出现了多次").toBe(1);
  });
});

describe("回滚", () => {
  const body = () => fn("runRollback");

  it("没有可回滚版本时说清楚，不抛错", () => {
    expect(body()).toContain("没有可回滚的版本");
  });

  it("记录说有、目录不在时**指名那个路径**", () => {
    const b = body();
    expect(b).toMatch(/existsSync\(keptAt\)/);
    expect(b).toMatch(/\$\{keptAt\}|keptAt\}/);
  });

  it("**回滚也保留当前版本**——不是单向丢弃", () => {
    const b = body();
    expectOrder(b, "renameSync(BUNDLE_DIR(), asideNow)", "renameSync(keptAt, BUNDLE_DIR())",
      "回滚必须先把当前版本挪开保留，再把旧版换回来");
  });

  it("回滚记一条 kind=rollback 的历史——回滚是前进", () => {
    expect(body()).toMatch(/kind: "rollback"/);
  });
});

describe("菜单里真的能点到", () => {
  it("两项都在帮助菜单里", () => {
    const menu = MAIN.slice(MAIN.indexOf("function installMenu"));
    expect(menu).toContain("安装离线更新包…");
    expect(menu).toContain("回滚到上一版");
    expect(menu).toMatch(/runUpdate\(\)/);
    expect(menu).toMatch(/runRollback\(\)/);
  });
});

/**
 * 「更新不打断生成」（#3872 R20 改进点 ⑤ —— 我自己写门时漏掉的那条）。
 *
 * 评分卡维度 8 的九分判据里有这一条，而更新要换掉 `bundle/` 并重启进程。
 */
describe("更新不打断生成", () => {
  const guard = () => {
    const i = MAIN.indexOf("async function confirmNoActiveRuns(");
    expect(i, "找不到 confirmNoActiveRuns").toBeGreaterThan(-1);
    return MAIN.slice(i, MAIN.indexOf("\nasync function ", i + 10));
  };

  it("更新与回滚**都**在动文件之前问一句", () => {
    expectOrder(fn("runUpdate"), 'confirmNoActiveRuns("更新")', "cpSync(", "更新必须先问再动文件");
    expectOrder(fn("runRollback"), 'confirmNoActiveRuns("回滚")', "renameSync(keptAt, BUNDLE_DIR())", "回滚必须先问再动文件");
  });

  it("**读不到任务状态时当「不知道」，不当「空闲」**", () => {
    /*
      这是最要紧的一条：一旦这个查询坏掉（表名改了、库连不上），
      「不打断」不能自动退化成「静默打断」——那种失效没有任何人会发现。
    */
    const g = guard();
    expect(g, "只在 === 0 时放行").toMatch(/if \(n === 0\) return true;/);
    expect(g, "null 要走「无法确认」那条分支").toMatch(/n === null/);
    expect(g).toMatch(/无法确认/);
    // 反面：不许把 null 当 0 处理
    expect(g).not.toMatch(/n\s*\?\?\s*0/);
    expect(g).not.toMatch(/\(n \|\| 0\) === 0/);
  });

  it("默认按钮是「先不要」——不要让回车键打断别人的任务", () => {
    const g = guard();
    expect(g).toMatch(/defaultId: 0/);
    expect(g).toMatch(/cancelId: 0/);
    expect(g).toMatch(/buttons: \["先不要"/);
  });

  it("说清代价：中断的是进度，不是数据", () => {
    const g = guard();
    expect(g).toMatch(/数据不会丢|已经产出的内容会保留/);
  });
});
