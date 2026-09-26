/**
 * 迭代 24 —— **取材夹具必须过契约**。
 *
 * `scripts/lib/design-loop-fixtures.mjs` 同时是三样东西的数据源：两条 e2e（响应式、原型主链路）、
 * 签核用的截图脚本、以及真浏览器审计门的取样对象。它是 `.mjs`，**不过 tsc**——于是契约加一个
 * 必给字段、夹具没跟上时，没有任何东西会红。
 *
 * 这不是假想的风险，是今天刚发生过两次的事实：
 *   · `InboxItem.tags`（2026-09-08 从 `exception` 上提到条目本身）夹具没跟上
 *     ⇒ 每张卡片的 `TagEditor` 在 `tags.length` 上炸；
 *   · `getInboxCounts.out.byTag`（同一批）夹具没给
 *     ⇒ `counts.byTag.length` 在 undefined 上炸。
 * 两处的表现都不是"少显示点东西"，而是**整屏白**——而 `/preview/feedback-design-loop?scene=inbox-board`
 * 在 main 上就是白的，三条本该抓到它的 e2e 一次都没在 CI 上跑过（本轮同时修了那道门）。
 *
 * ⭐ 反证锚点：把夹具里任意一条 `tags: []` 删掉 ⇒ 这里当场红，而不是等某天有人打开那一屏。
 */
import { describe, expect, it } from "vitest";
import { inbox as inboxContract, designWorkbench } from "@repo/contracts";
import { DESIGN_PROJECTS, INBOX_ITEMS } from "@/scripts/lib/design-loop-fixtures.mjs";

describe("design-loop 取材夹具与契约同形", () => {
  it("每一条收件箱条目都过 `InboxItem`", () => {
    expect(INBOX_ITEMS.length).toBeGreaterThan(0); // 空数组会让下面那圈循环空转，那是"以错误的理由通过"
    for (const item of INBOX_ITEMS as unknown[]) {
      const parsed = inboxContract.InboxItem.safeParse(item);
      expect(parsed.success, `条目 ${JSON.stringify((item as { code?: string }).code)} 不过契约：${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
    }
  });

  it("每一个设计项目都过 `DesignProject`", () => {
    expect(DESIGN_PROJECTS.length).toBeGreaterThan(0);
    for (const project of DESIGN_PROJECTS as unknown[]) {
      const parsed = designWorkbench.DesignProject.safeParse(project);
      expect(parsed.success, `项目 ${JSON.stringify((project as { id?: string }).id)} 不过契约：${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
    }
  });
});
