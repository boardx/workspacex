import { expect, test } from "@playwright/test";
import { MODE_EVAL } from "./kg-mode-acceptance.fixture";
import { login, newThread, openMemoryPanel, tell } from "./kg-experience-eval/eval-helpers";

test.setTimeout(240_000);
for (const mode of ["cloud", "local"] as const) {
  test(`[graph-${mode}] 聊天入图 → 三栏无重叠 → 中文关系聚焦 → 整理复位 → 原文来源`, async ({ page }, testInfo) => {
    await login(page, MODE_EVAL.account);
    if (mode === "local") {
      await page.getByTestId("org-switcher").click();
      await page.getByTestId(`org-switcher-option-${MODE_EVAL.localOrgId}`).click();
      await page.waitForURL(/\/projects(?:\?|$)/);
    }
    const thread = await newThread(page);
    await tell(page, thread, ["M5", "M7"]);
    await openMemoryPanel(page);
    await page.getByTestId("kg-view-graph").click();
    const canvas = page.getByTestId("kg-graph-canvas");
    await expect(canvas.locator(".react-flow__node")).toHaveCount(9);
    await expect.poll(async () => canvas.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return [...el.querySelectorAll(".react-flow__node")].every(n => { const r = n.getBoundingClientRect(); return r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1; });
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-01-sidebar.png`), fullPage: true });
    await canvas.getByRole("button", { name: "放大关系图" }).click();
    const dialog = page.getByRole("dialog", { name: "关系图", exact: true });
    await expect(dialog.locator(".react-flow__node")).toHaveCount(9);
    const geometry = await dialog.evaluate(el => {
      const nodes = [...el.querySelectorAll(".react-flow__node")].map(n => { const r = n.getBoundingClientRect(); return { id: n.getAttribute("data-id"), x: r.x, y: r.y, width: r.width, height: r.height }; });
      const overlaps: string[] = [];
      for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) { const a=nodes[i]!,b=nodes[j]!; if (a.x < b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y) overlaps.push(`${a.id}/${b.id}`); }
      return { nodes, overlaps, edges: [...el.querySelectorAll(".react-flow__edge-path")].map(e => e.getAttribute("d")) };
    });
    expect(geometry.overlaps).toEqual([]);
    expect(geometry.edges.length).toBeGreaterThan(0);
    expect(geometry.edges.every(e => !!e && !e.includes("NaN"))).toBe(true);
    await page.mouse.move(0,0);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-02-expanded.png`), fullPage: true });
    const object = dialog.locator(".react-flow__node[data-id^='object:']").filter({ hasText: "北极星项目" }).first();
    await object.click();
    await page.mouse.move(0,0);
    const labels = dialog.locator("[data-testid^='kg-graph-label-']");
    await expect(labels.first()).toBeVisible();
    expect((await labels.allTextContents()).every(t => !/[a-z_]/i.test(t))).toBe(true);
    expect(await labels.evaluateAll(elements => {
      const boxes = elements.map(el => el.getBoundingClientRect());
      return boxes.every((a, i) => boxes.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    })).toBe(true);
    await expect(dialog.getByRole("button", { name: /取消聚焦/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-03-focus.png`), fullPage: true });
    await dialog.getByRole("button", { name: /取消聚焦/ }).click();
    const node = dialog.locator(".react-flow__node[data-id^='object:']").first();
    const before = await node.getAttribute("style");
    const box = (await node.boundingBox())!;
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down(); await page.mouse.move(box.x+box.width/2+45,box.y+box.height/2+35,{steps:8}); await page.mouse.up();
    await expect(node).not.toHaveAttribute("style",before!);
    await dialog.getByRole("button", { name: "重新编排", exact:true }).click();
    await expect(node).toHaveAttribute("style",before!);
    await page.mouse.move(0,0);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-04-reset.png`), fullPage: true });
    const claim = dialog.locator(".react-flow__node[data-id^='claim:']").first();
    await claim.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("kg-source-drawer")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-05-source.png`), fullPage: true });
    await testInfo.attach("graph-geometry",{body:JSON.stringify(geometry),contentType:"application/json"});
  });
}
test("[graph-responsive] 375/768/1440画布和放大视图无页面横向溢出", async ({ page },testInfo) => {
  await login(page,MODE_EVAL.account);
  const thread=await newThread(page); await tell(page,thread,["M5","M7"]); await openMemoryPanel(page); await page.getByTestId("kg-view-graph").click();
  for(const width of [375,768,1440]) {
    await page.setViewportSize({width,height:900});
    const mobile = page.getByTestId("chat-task-workbench-mobile-open");
    if (await mobile.isVisible() && await mobile.getAttribute("aria-expanded") !== "true") await mobile.click();
    await openMemoryPanel(page);
    await page.getByTestId("kg-view-graph").click();
    await page.getByRole("button",{name:"放大关系图"}).click();
    const dialog=page.getByRole("dialog", { name: "关系图", exact: true }); await expect(dialog.locator(".react-flow__node")).toHaveCount(9);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const b=(await dialog.boundingBox())!;expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width+1);
    await page.screenshot({path:testInfo.outputPath(`responsive-${width}.png`),fullPage:true});
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  }
});
