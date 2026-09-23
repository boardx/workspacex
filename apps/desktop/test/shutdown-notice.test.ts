/**
 * 关机路径上必须有可见反馈，而且必须有上限（#3872 R10）。
 *
 * 为什么钉这两条，见 `shutdown-notice.ts` 的文件头：这台机器的 desktop.log 里
 * 「上次被硬杀导致数据库打不开」已经发生 6 次。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHUTDOWN_TIMEOUT_MS, shutdownNoticeHtml } from "../src/shutdown-notice";

/**
 * 只看 `before-quit` 那一段。
 *
 * ⚠ 全文 grep 在这个仓里已经骗过我四次：`BrowserWindow`、`appendLog`、`setTimeout`
 *   在 main.ts 里到处都有，断言会被别处**早就存在**的代码满足，删掉关机逻辑照样绿。
 */
function beforeQuitBlock(): string {
  const src = readFileSync(join(__dirname, "..", "src", "main.ts"), "utf8");
  const i = src.indexOf('app.on("before-quit"');
  expect(i, "main.ts 里找不到 before-quit 钩子").toBeGreaterThan(-1);
  return src.slice(i);
}

describe("关机那几秒", () => {
  it("在停栈之前就把提示窗摆出来——停完再说等于没说", () => {
    const b = beforeQuitBlock();
    const notice = b.indexOf("shutdownNoticeDataUrl");
    const stop = b.indexOf("s.stop()");
    expect(notice).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(stop);
  });

  it("有超时上限，超时后真的放行退出", () => {
    const b = beforeQuitBlock();
    expect(b).toContain("SHUTDOWN_TIMEOUT_MS");
    // 上限只有在它触发时会退出才算上限
    const cap = b.slice(b.indexOf("SHUTDOWN_TIMEOUT_MS)"), b.indexOf("SHUTDOWN_TIMEOUT_MS)") + 200);
    expect(cap).toMatch(/done\(/);
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("收尾用了多久要写进日志——否则下次没人知道该不该调这个上限", () => {
    expect(beforeQuitBlock()).toMatch(/\[shutdown\]/);
  });
});

describe("提示页自己", () => {
  it("说清正在做什么，并明确劝住强制退出", () => {
    const h = shutdownNoticeHtml();
    expect(h).toContain("正在安全关闭");
    expect(h).toContain("不要强制退出");
    expect(h).toMatch(/数据库/);
  });

  it("深色模式下不是白底黑字硬贴上来的", () => {
    // 本仓已有过「实心 -foreground 在浅色下是白字白底」那一类事故：颜色要两套都给。
    expect(shutdownNoticeHtml()).toContain("prefers-color-scheme: dark");
  });
});
