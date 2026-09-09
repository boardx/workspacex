import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";

/**
 * issue #3205 —— 展开一步工具轨迹时，它的卡片与上面那条折叠行**盒子互相穿插**。
 *
 * ## 为什么这条断言必须跑在真浏览器里
 * 判据是几何事实（两个盒子的间距），jsdom 没有布局引擎，`getBoundingClientRect()`
 * 恒返回全 0——在那里写这条断言只会得到一条永远绿的假门控。同理**不许**用截图字节数
 * 或元素存在性代替（本仓 C2 的反面教材：PNG 体量比 + 0.15 阈值，既抓不到目标又被
 * 自己承认的 1–2px 噪声打红）。
 *
 * ## 为什么不需要起整个应用
 * 被测对象是 `RunTracePanel` 一个组件的盒模型。夹具用**真组件**渲染
 * （`e2e/fixtures/trace-disclosure-fixture.tsx`，另起进程是因为 Playwright 的转译器
 * 会把 JSX 编译成它自己的组件测试节点）+ **真样式**（`tailwindcss` CLI 按本应用的
 * `tailwind.config.ts` 与 `app/globals.css` 编译）。两侧都不是替身，只是没有数据链路。
 * 起 next dev 只会让这条 200ms 的断言变慢且随负载假红，测不到更多东西。
 *
 * ## 判据
 * `:focus-visible` 的全局兜底（`app/globals.css`）是 `ring-2 ring-offset-2`：焦点环画在
 * 元素盒子**外面** 4px。折叠行与展开出来的卡片之间若没有至少这么宽的净空，焦点环那一圈
 * 就整个落进卡片矩形里，而卡片不透明的 `bg-card` 在树序上后画——环被盖掉，人看到的就是
 * 「fetch_url 卡片盖住上面那一行、边界互相穿插」。
 */
function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "trace-geometry-"));
  const page = join(dir, "page.html");
  const web = join(__dirname, "..");
  execFileSync(process.execPath, ["--import", "tsx", join(__dirname, "fixtures", "trace-disclosure-fixture.tsx"), page], { cwd: web, stdio: "pipe" });
  execFileSync(join(web, "node_modules", ".bin", "tailwindcss"),
    ["-c", "tailwind.config.ts", "-i", "app/globals.css", "-o", join(dir, "out.css"), "--content", page],
    { cwd: web, stdio: "pipe" });
  return pathToFileURL(page).href;
}

const FOCUS_RING_REACH = 4; // ring-offset-2 (2px) + ring-2 (2px)


test("#3205：展开的工具卡片与它上面那条折叠行之间必须有净空，两个盒子不得互相穿插", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(buildFixture());
  // 展开这一步——就是人类在 devapp 上点的那一下。
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));

  const measured = await page.evaluate(() => {
    const rows: { status: string; gap: number }[] = [];
    document.querySelectorAll("details").forEach((d) => {
      const summary = d.querySelector("summary");
      const card = d.querySelector('[data-testid="tool-card"]');
      if (!summary || !card) return;
      rows.push({
        status: (d.closest("li") as HTMLElement).dataset.status ?? "?",
        gap: Number((card.getBoundingClientRect().top - summary.getBoundingClientRect().bottom).toFixed(2)),
      });
    });
    return rows;
  });

  expect(measured.length, "夹具应同时含失败态与成功态两条工具步骤").toBe(2);
  expect(measured.map((row) => row.status).sort()).toEqual(["failed", "succeeded"]);
  for (const row of measured) {
    expect(
      row.gap,
      [
        `【#3205】data-status=${row.status} 这一步展开后，折叠行底边与卡片顶边净空实测 ${row.gap}px。`,
        `全局 :focus-visible 是 ring-2 + ring-offset-2，会在折叠行盒子外画 ${FOCUS_RING_REACH}px；`,
        "净空小于它，那一圈描边就整个落进卡片矩形里，被卡片不透明的 bg-card 盖掉——",
        "人类在 devapp 上看到的「fetch_url 卡片盖住上面那一行、边界互相穿插」就是这个。",
        "注意：失败态与成功态两条的几何完全相同，这不是失败态专属的描边容器问题。",
      ].join("\n"),
    ).toBeGreaterThanOrEqual(FOCUS_RING_REACH);
  }
});
