/**
 * 装模型不许挡住界面（#3872 R15）。
 *
 * ## 实测的代价
 *
 * 一次**正常启动**（非首次，SHA 02413d08f，真实打包产物）：
 *
 * | | |
 * | --- | --- |
 * | +1.6s | Ollama 应答 |
 * | +2.1s → **+20.1s** | **18 秒静默**，然后 `MLX engine initialized` |
 * | +23.3s | API 才 listening |
 * | +26.1s | Web ready |
 *
 * 那 18 秒是 `up()` 在关键路径上 `await probeChatModel`——它发一次真实的
 * chat completion（`max_tokens:1`），于是把 4 GB 权重整个加载进内存。
 * R7 把语音（27%）和技能沙箱（17%）挪出了关键路径，**独独漏了这一项，
 * 而它比那两个加起来还贵**。
 *
 * 延后之后它同时变成**后台预热**：promise 在 push 的那一刻就开始跑，
 * 与 API / web 的启动并行；用户读完首屏再打字，这段时间正好用来装权重。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_IMPACT, SERVICE_LABELS } from "../src/supervisor-policy";

const UP = readFileSync(join(__dirname, "..", "src", "up.ts"), "utf8");

/** `deferredReady.push({ name: "model", … })` 那一整块。 */
function deferredModelBlock(): string {
  const i = UP.indexOf('name: "model"');
  expect(i, "up.ts 里找不到 name: \"model\" 的延后项").toBeGreaterThan(-1);
  const start = UP.lastIndexOf("deferredReady.push(", i);
  expect(start, "那个 name: \"model\" 不在 deferredReady.push 里").toBeGreaterThan(-1);
  return UP.slice(start, i + 1200);
}

describe("模型装载不在关键路径上", () => {
  it("**`probeChatModel` 唯一的调用点在延后块里**", () => {
    // ⚠ 断言写成「块里有 probeChatModel」是不够的：把它**再**放回关键路径上，
    //   那条断言照样绿（本仓这一天已被这种写法骗过四次）。要钉的是「只有这一处」。
    const block = deferredModelBlock();
    const callsInFile = [...UP.matchAll(/probeChatModel\(/g)].length;
    const callsInBlock = [...block.matchAll(/probeChatModel\(/g)].length;
    expect(callsInBlock, "延后块里没有调用 probeChatModel").toBe(1);
    expect(callsInFile, "up.ts 里还有别处调用 probeChatModel——它又回到关键路径上了").toBe(1);
  });

  it("embedding 探测也一起延后，不单独挡路", () => {
    const block = deferredModelBlock();
    expect([...block.matchAll(/probeEmbeddingModel\(/g)].length).toBe(1);
    expect([...UP.matchAll(/probeEmbeddingModel\(/g)].length).toBe(1);
  });

  it("延后项在 API 起来之前就开始跑——否则装权重和启动不是并行的", () => {
    const pushAt = UP.indexOf('name: "model"');
    const apiAt = UP.indexOf('name: "api"');
    expect(apiAt, "找不到 API 的 spawn").toBeGreaterThan(-1);
    expect(pushAt).toBeLessThan(apiAt);
  });

  it("装不上时有说人话的影响描述——延后不等于没人管", () => {
    expect(SERVICE_LABELS.model).toBeTruthy();
    expect(SERVICE_IMPACT.model).toContain("其余功能不受影响");
    expect(SERVICE_IMPACT.model).not.toMatch(/probe|preflight|exit code/i);
  });

  it("embedding 失败不判整条「模型」失败——聊天还能用", () => {
    const block = deferredModelBlock();
    const embedPart = block.slice(block.indexOf("probeEmbeddingModel("));
    expect(embedPart, "embedding 不 ok 时不许 throw").not.toMatch(/if \(!embed\.ok\) throw/);
  });
});

/**
 * ⚠ **这一节是 R18 补的，因为上面那几条钉错了函数。**
 *
 * R15 我把 `probeChatModel` 挪出关键路径，并断言它只有一个调用点——那条断言是真的，
 * 但它**管不着真正挡首屏的那一次**：`up.ts` 里还有一个
 * `await warmModel(ollamaUrl, chosen)`，它才是把 4 GB 权重装进内存的调用，
 * 而且**仍然在关键路径上**。
 *
 * 那个 await 有正当理由（#3749 R9 的注释）：「库里有这个标签」不等于「这台机器能跑它」，
 * 预热就是那次验证，预热不过就回落到非 MLX 版——宁可慢，也不让用户的第一条消息
 * 撞上一个起不来的运行器。所以这里**不要求把它也挪走**，要求的是：
 *
 * 1. 关键路径上**只剩这一处**模型装载（多一处就是又把时间加回来了）；
 * 2. 它带着说明为什么必须阻塞的注释（否则下一个人会以为它是漏改的）；
 * 3. 回落分支还在（删了它，MLX 起不来的机器就彻底没有聊天）。
 *
 * 这样这份测试说的话与代码实际做的事一致——R15 那几条给人的印象是
 * 「模型装载已经不挡首屏了」，而实测冷机仍然约 18 秒。
 */
describe("关键路径上的模型装载：只剩一处，且说清为什么", () => {
  it("`await warmModel` 在 up.ts 里只有一处", () => {
    const awaited = [...UP.matchAll(/await\s+warmModel\(/g)].length;
    expect(awaited, "关键路径上的阻塞式模型装载不止一处").toBe(1);
  });

  it("非阻塞的那次预热用的是 `void`，不是 await", () => {
    expect(UP).toMatch(/void\s+warmModel\(/);
  });

  it("阻塞那一处带着「为什么必须阻塞」的理由", () => {
    const i = UP.search(/await\s+warmModel\(/);
    const before = UP.slice(Math.max(0, i - 400), i);
    expect(before, "阻塞式装载旁边没有写明理由，下一个人会当成漏改").toMatch(/不等于|验证|回落|fallback/);
  });

  it("**MLX 起不来时的回落分支还在**——删了它，那类机器就彻底没有聊天", () => {
    const i = UP.search(/await\s+warmModel\(/);
    const block = UP.slice(i, i + 700);
    expect(block).toMatch(/falling back to|chatModel: fallback/);
    expect(block, "库里没有非 MLX 版时要如实说，不能静默").toMatch(/没有非 MLX 版可回落|warnings\.push/);
  });
});
