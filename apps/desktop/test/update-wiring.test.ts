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

describe("更新与回滚：桌面壳只是薄壳", () => {
  /*
    2026-09-27 改为共用核心（local-runtime 的 applyUpdate / rollbackBundle）。
    改之前 main.ts 内联了一份应用逻辑，有个真缺陷：拷到一半失败时 bundle 已存在（半新半旧），
    还原条件「bundle 不存在才搬回旧的」不成立，于是不还原——弹窗却说「已还原到更新前」。
    原来这里的门只检查源码里有那句 renameSync，从没让拷贝真的失败过。

    「先验再动 / 旧版保留 / 失败不留半新半旧」现在由核心的**真实文件系统**测试钉住
    （test/update-apply-rollback.test.ts，含让拷贝写进一半再失败的用例）。
    这里只钉桌面壳这一侧该守的：**不再自己动 bundle**，否则逻辑会漂回第二份副本。
  */
  it("**main.ts 不直接改 bundle 目录**——动文件的只有共用核心", () => {
    const upd = fn("runUpdate");
    const rb = fn("runRollback");
    for (const [name, body] of [["runUpdate", upd], ["runRollback", rb]] as const) {
      expect(body, `${name} 又自己拷文件了`).not.toMatch(/cpSync\(/);
      expect(body, `${name} 又自己改名 bundle 了`).not.toMatch(/renameSync\([^)]*BUNDLE_DIR/);
      expect(body, `${name} 又自己写版本标记了`).not.toMatch(/writeFileSync\([^)]*BUNDLE_VERSION_FILE/);
    }
    expect(upd).toMatch(/applyUpdate\(/);
    expect(rb).toMatch(/rollbackBundle\(/);
  });

  it("「当前版本」读 bundle 自己的标记，不是外壳的 package.json", () => {
    expect(fn("runUpdate")).toMatch(/readBundleVersion\(BUNDLE_DIR\(\), app\.getVersion\(\)\)/);
    expect(fn("runUpdate"), "把外壳版本直接当当前版本传给 inspectUpdate").not.toMatch(/inspectUpdate\([^)]*app\.getVersion\(\)/);
  });

  it("失败弹窗只说核心真正保证的事", () => {
    /*
      第一版说「已还原到更新前」而代码做不到。现在核心在失败时返回 touched:false，
      意思是「一个字节都没动」，所以弹窗说「应用没有被改动」——且不再出现「已还原」。
    */
    const upd = fn("runUpdate");
    expect(upd).toMatch(/应用没有被改动/);
    expect(upd, "又出现了代码做不到的承诺").not.toMatch(/已还原到更新前/);
  });

  it("**那三样换不了要说出口**，而且文案只写一处", () => {
    expect(MAIN).toContain("UPDATE_SCOPE_NOTE");
    const note = MAIN.slice(MAIN.indexOf("const UPDATE_SCOPE_NOTE"), MAIN.indexOf("const UPDATE_SCOPE_NOTE") + 400);
    expect(note).toMatch(/外壳/);
    expect(note).toMatch(/模型/);
    expect(note).toMatch(/Ollama/);
    expect(note).toMatch(/重新安装/);
    expect(MAIN.split("离线更新换的是应用逻辑").length - 1, "这句话出现了多次").toBe(1);
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
    expectOrder(fn("runUpdate"), 'confirmNoActiveRuns("更新")', "applyUpdate(", "更新必须先问再动文件");
    expectOrder(fn("runRollback"), 'confirmNoActiveRuns("回滚")', "rollbackBundle(", "回滚必须先问再动文件");
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
