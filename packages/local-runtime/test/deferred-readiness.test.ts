/**
 * 技能沙箱与语音转写的就绪等待不许回到首屏关键路径上（#3872 R7）。
 *
 * ## 为什么要有这道门
 * 实测 15 次真实启动：到「加载界面」中位 6.8 s，其中语音转写 1.8 s（27%）、
 * 技能沙箱 1.2 s（17%）——加起来 44%，而用户开头几秒都用不到它们。
 * 把这两个 `await` 移出关键路径后，同机同数据目录实测 5.82 s → 4.31 s。
 *
 * 这条回归门挡的是「有人为了让启动日志看起来更整齐，把 await 加回去」——
 * 那会静默地把 1.5 秒还回去，而没有任何东西会红。
 *
 * ## 这是静态痕迹，不是动态事实，我知道
 * 它证明的是「源码里没有在返回前 await 这两个就绪」，不证明启动真的更快——
 * 那件事由 `evidence/local-desktop/audit/2026-09-23-installed-app.md` 的实测数字负责。
 * 两者各管一半：数字会过期，源码形状不会。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/up.ts", import.meta.url)), "utf8");

describe("不挡首屏的就绪等待", () => {
  it("技能沙箱的就绪进了 deferredReady，没有被 await", () => {
    expect(src).toMatch(/deferredReady\.push\(\{[\s\S]{0,200}?name: "skill-sandbox"/);
    expect(src).not.toMatch(/await waitForHttpOrExit\(`http:\/\/127\.0\.0\.1:\$\{c\.ports\.sandbox\}/);
  });

  it("语音转写的就绪进了 deferredReady，没有被 await", () => {
    expect(src).toMatch(/deferredReady\.push\(\{[\s\S]{0,200}?name: "asr-gateway"/);
    expect(src).not.toMatch(/await waitForHttpOrExit\(`ws:\/\/|await waitForHttpOrExit\(`http:\/\/127\.0\.0\.1:\$\{c\.ports\.asr\}/);
  });

  it("**本地服务与智能体仍然挡首屏**——界面没有它们就是坏的，不能延后", () => {
    expect(src).toMatch(/await waitForHttpOrExit\(`\$\{apiUrl\}\/healthz`/);
    expect(src).toMatch(/await waitForHttpOrExit\(`\$\{deepAgentUrl\}\/healthz`/);
  });

  it("延后的失败必须走健康通道说出来，不能被吞掉", () => {
    // ⚠ 不能对整份源码断言 `onServiceHealth?.(h)`：监督那一段里**也有一处**，
    // 于是把延后这一段的那句删掉，断言照样满足（实测过，反证不红）。
    // 断言必须限定在延后那一段里。
    const i = src.indexOf("for (const d of deferredReady)");
    expect(i, "找不到延后那一段").toBeGreaterThan(0);
    const block = src.slice(i, i + 900);
    expect(block).toContain("onServiceHealth?.(h)");
  });

  it("我们自己关应用时不把那些失败当故障报出去", () => {
    // 退出时这些等待必然失败（进程被停了），报出去就是每次退出弹一个假警报。
    const block = src.slice(src.indexOf("for (const d of deferredReady)"));
    expect(block.slice(0, 900)).toContain("if (stopping) return;");
  });
});
