// issue #2785 截图：node shoot.mjs <输出目录>（目录里须已有 harness 生成的 index.html + tailwind 编译的 out.css）
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const dir = resolve(process.argv[2] ?? "node_modules/.cache/butterfly-shots") + "/";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
async function shoot(name, reducedMotion, sel, opts = {}) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, reducedMotion });
  const page = await ctx.newPage();
  await page.goto("file://" + dir + "index.html");
  if (opts.dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(opts.wait ?? 0);
  const anim = await page.$eval(sel + " svg", (el) => {
    const cs = getComputedStyle(el);
    return { animationName: cs.animationName, duration: cs.animationDuration, color: cs.color };
  });
  await page.locator(sel).screenshot({ path: dir + name + ".png" });
  console.log(name, JSON.stringify(anim));
  await ctx.close();
}
for (const m of ["flap", "drift"]) {
  for (const s of ["preparing", "acting", "replying"]) await shoot(`${m}-${s}`, "no-preference", `[data-shot="${m}-${s}"]`, { wait: m === "drift" ? 450 : 0 });
  await shoot(`${m}-replying-reduced-motion`, "reduce", `[data-shot="${m}-replying"]`);
  await shoot(`${m}-large`, "no-preference", `[data-shot="${m}-large"]`, { wait: 550 });
  await shoot(`${m}-replying-dark`, "no-preference", `[data-shot="${m}-replying"]`, { dark: true });
  // 候选整版截图（贴 issue 用）：标题 + 三阶段卡 + 放大图形标，一张图看全貌。
  await shoot(`candidate-${m === "flap" ? "a" : "b"}-${m}`, "no-preference", `[data-shot-section="${m}"]`, { wait: 550 });
  // 两帧对比证明动效真的在动（同一元素相隔约半个周期）。
  await shoot(`${m}-replying-t0`, "no-preference", `[data-shot="${m}-replying"]`, { wait: 0 });
  await shoot(`${m}-replying-t-half`, "no-preference", `[data-shot="${m}-replying"]`, {
    wait: m === "flap" ? 550 : 900,
  });
}
await browser.close();
