import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";

/**
 * issue #3246 —— 铃铛搬进左侧图标导航栏之后的**几何门控**。
 *
 * 判据是 `getBoundingClientRect()` 的数字：弹层必须**向右**展开、必须整个落在视口里、
 * 长列表必须在弹层**内部**滚动而不是把左栏撑长。
 * jsdom 没有布局引擎（rect 恒 0），结构断言在 `tests/ui/rail-notifications-placement.test.tsx`；
 * **不许**用截图字节数或"元素存在"代替（本仓 C2 反面教材：PNG 体量比 + 0.15 阈值，
 * 既抓不到目标又被自己承认的 1–2px 噪声打红）。
 *
 * 夹具用真组件的盒模型常量 + 真编译样式（tailwind CLI 按本应用配置），见夹具头注。
 * 不起应用：被测对象是四个盒子的相对位置，起 next dev 只会让 200ms 的断言变慢且随负载假红。
 */
function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "rail-notifications-geometry-"));
  const page = join(dir, "page.html");
  const web = join(__dirname, "..");
  execFileSync(process.execPath, ["--import", "tsx", join(__dirname, "fixtures", "rail-notifications-fixture.tsx"), page], { cwd: web, stdio: "pipe" });
  execFileSync(join(web, "node_modules", ".bin", "tailwindcss"),
    ["-c", "tailwind.config.ts", "-i", "app/globals.css", "-o", join(dir, "out.css"), "--content", page],
    { cwd: web, stdio: "pipe" });
  return pathToFileURL(page).href;
}

const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 1280, height: 620 }];

for (const viewport of VIEWPORTS) {
  test(`#3246：${viewport.width}×${viewport.height} 下通知弹层向右展开、不出视口、在自己内部滚`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(buildFixture());

    const geom = await page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`fixture missing ${sel}`);
        return el.getBoundingClientRect();
      };
      const pop = document.querySelector('[data-testid="task-notifications-popover"]') as HTMLElement;
      const rail = document.querySelector('[data-testid="shell-rail"]') as HTMLElement;
      return {
        nav: box('[data-testid="shell-rail"]').toJSON(),
        bottom: box('[data-testid="rail-bottom"]').toJSON(),
        trigger: box('[data-testid="task-notifications-trigger"]').toJSON(),
        popover: pop.getBoundingClientRect().toJSON(),
        items: document.querySelectorAll('[data-testid="notification-item"]').length,
        popScroll: { sh: pop.scrollHeight, ch: pop.clientHeight },
        navScroll: { sh: rail.scrollHeight, ch: rail.clientHeight },
        vw: window.innerWidth, vh: window.innerHeight,
        docScroll: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
      };
    });

    // 阳性对照：夹具真的摆出了一个非空的、被撑到高度上限的弹层。若哪天它退化成空/零尺寸，
    // 下面所有"不越界"的断言都会变成对着一个 0×0 盒子的静默假绿——这一条先红。
    expect(geom.items, "夹具应渲出足够多的通知条目把弹层撑满").toBeGreaterThan(10);
    expect(geom.popover.width, "弹层宽度为 0 = 夹具坏了，后面的几何断言无意义").toBeGreaterThan(200);
    expect(geom.popover.height).toBeGreaterThan(100);

    // ① 向右展开：弹层左边缘在 trigger 右边缘之外，且整体在 nav 盒子右侧（不压住导航项）。
    expect(
      geom.popover.left,
      `弹层左边缘 ${geom.popover.left} 应在 trigger 右边缘 ${geom.trigger.right} 之外——左栏贴屏幕最左且很窄，向下/向左展开都会被裁。`,
    ).toBeGreaterThanOrEqual(geom.trigger.right);
    expect(geom.popover.left).toBeGreaterThanOrEqual(geom.nav.right - 1);

    // ② 不出视口：四条边都在里面。`bottom` 这条正是"锚底边向上生长"要保证的事——
    //    trigger 钉在栏底，向下展开必然被视口底边裁掉。
    expect(geom.popover.top, `弹层顶边 ${geom.popover.top} 越出视口上沿`).toBeGreaterThanOrEqual(0);
    expect(geom.popover.bottom, `弹层底边 ${geom.popover.bottom} 越出视口下沿 ${geom.vh}`).toBeLessThanOrEqual(geom.vh);
    expect(geom.popover.right, `弹层右边缘 ${geom.popover.right} 越出视口右沿 ${geom.vw}`).toBeLessThanOrEqual(geom.vw);

    // ③ 长列表在弹层**内部**滚，不把左栏撑长、不产生页面级横向滚动。
    expect(
      geom.popScroll.sh - geom.popScroll.ch,
      "24 条通知没有把弹层撑到需要内部滚动——`max-h` 没生效，它会一路长出去",
    ).toBeGreaterThan(0);
    expect(geom.navScroll.sh - geom.navScroll.ch, "弹层把导航栏本身撑出了滚动").toBeLessThanOrEqual(1);
    expect(geom.docScroll, "出现了页面级横向滚动").toBeLessThanOrEqual(1);

    // ④ 真的画出来了，不是"盒子在那儿但被祖先裁掉"。
    //    `getBoundingClientRect` 读不出 `overflow` 裁剪——nav 加回 `overflow-hidden`
    //    时上面每一条都照样绿，而用户什么都看不见。命中测试才分得开这两种情况。
    const hit = await page.evaluate(() => {
      const pop = document.querySelector('[data-testid="task-notifications-popover"]') as HTMLElement;
      const r = pop.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { insidePopover: el !== null && pop.contains(el), hitTag: el?.getAttribute("data-testid") ?? el?.tagName ?? null };
    });
    expect(
      hit.insidePopover,
      `弹层中心点命中的是 ${hit.hitTag} 而不是弹层自己——盒子在，但被祖先的 overflow 裁掉了（nav 不许 overflow-hidden）。`,
    ).toBe(true);

    // ⑤ 弹层真的能滚（不是"有溢出但滚不动"）——量真实位移，不是只看 scrollHeight。
    const moved = await page.evaluate(() => {
      const pop = document.querySelector('[data-testid="task-notifications-popover"]') as HTMLElement;
      pop.scrollTop = 10_000;
      return pop.scrollTop;
    });
    expect(moved, "弹层有溢出却滚不动").toBeGreaterThan(0);
  });
}
