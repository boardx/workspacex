/**
 * 端到端自检：蓝本设计器 14 项配置（13 个 designFacetKey + 基本配置聚合页）
 * **全部是结构化面板**，且真读真写真落库。
 *
 * ⚠ 2026-08-31 产品决策移除 `roles-and-perms`（角色与权限）/`group-capabilities`
 * （组内能力）两项——原 16 项（15 个 designFacetKey + 基本配置）降为 14 项
 * （13 个 designFacetKey + 基本配置）。本文件标题与断言里的数字已同步更新；
 * 分母仍从 `DESIGN_FACET_CATALOG` 派生，不在本文件手抄。
 *
 * ## 为什么要有这一条（不是重复 blueprint-contract-gap-audit）
 *
 * 人类 2026-08-18 的原话批评是「后台项目的每个项目配置菜单，现在都是一个 textbox，
 * 是错误的」。组件测试（`blueprint-designer-page-live.test.tsx`）已经用假 fetch 钉住
 * 了每一项的渲染与保存，registry 覆盖门控也钉住了「无一落回 FacetTextEditor」——
 * 但那些都是**在 jsdom 里对着 mock 断言**。这条用例在**真栈**（真 Next.js + 真 Nest
 * + 真 Postgres）里把 14 项逐个点开，回答的是另一个问题：
 *
 *   「一个真人打开这个页面，逐个点过去，看到的是不是 14 个结构化面板？」
 *
 * 它专门盯三件在 mock 下测不出来的事：
 *   ① 逐项点开后 DOM 里**不存在** `bp-facet-content-*`（那是通用自由文本框的锚点）；
 *   ② 挑几项做真实编辑 → 真实 PUT → **刷新页面**后值还在原来那一格（真落库，
 *      不是内存态，也不是被拼成一段文本又拆不开）；
 *   ③ 完成度徽标随保存联动，且数字来自服务端响应而不是前端自己 +1。
 */
import { test, expect, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { DESIGN_FACET_CATALOG } from "../lib/generated/design-facet-catalog";
import { FACET_INTRO } from "../components/tpl-designer/facet-editor-registry";

const API = "/__fullstack_api";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

const { scope } = (() => {
  const raw = process.env.WORKSPACEX_ISOLATION_ID ?? "fullstack-e2e";
  return { scope: raw.replace(/[^a-zA-Z0-9-]/g, "-").slice(-24) };
})();

const BLUEPRINT_NAME = `BP16_${scope}`;

/** 13 个 designFacetKey 来自**生成的定义表**，不是本文件手抄一份（抄一份就会漂移）。 */
const ALL_FACET_KEYS = DESIGN_FACET_CATALOG.groups.flatMap((g) => g.items.map((i) => i.designFacetKey));

test.describe.serial("端到端自检：蓝本设计器 14 项全部结构化，真读真写真落库", () => {
  let blueprintId = "";

  test("建一个蓝本，拿到它的 id", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/tpl/list");
    await expect(page.getByTestId("tpl-live-screen")).toBeVisible();
    await page.getByTestId("tpl-live-new").click();
    await expect(page.getByTestId("tpl-live-create-form")).toBeVisible();
    await page.getByTestId("tpl-live-new-name").fill(BLUEPRINT_NAME);
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === `${API}/blueprints` && r.request().method() === "POST",
      ),
      page.getByTestId("tpl-live-create-submit").click(),
    ]);
    expect(created.status()).toBe(201);

    // ⚠ 前缀选择器会连带匹配卡片内部的 tpl-live-card-name/-state 等子元素，
    //   必须用 Card 容器（div）收窄——同 blueprint-contract-gap-audit 的既有注释。
    const card = page.locator('div[data-testid^="tpl-live-card-bp-"]').filter({ hasText: BLUEPRINT_NAME });
    await expect(card).toBeVisible();
    const testId = await card.getAttribute("data-testid");
    blueprintId = (testId ?? "").replace("tpl-live-card-", "");
    expect(blueprintId).not.toBe("");
  });

  test("① 逐个点开 13 项 + 基本配置：每一项都是结构化面板，无一是通用自由文本框", async ({ page }) => {
    test.skip(blueprintId === "", "上一条没建出蓝本");
    await loginAsAdmin(page);
    await page.goto(`/tpl/designer?blueprintId=${blueprintId}`);
    await expect(page.getByTestId("bp-designer-shell")).toBeVisible();

    // 定义表里应当正好 13 项（roles-and-perms/group-capabilities 已移除）——
    // 数量本身也钉住，避免「少了一项也照样全绿」。
    expect(ALL_FACET_KEYS.length).toBe(13);

    for (const key of ALL_FACET_KEYS) {
      await page.getByTestId(`bp-designer-facet-${key}`).click();
      // 专属结构化编辑器的根节点在场……
      await expect(
        page.getByTestId(`bp-facet-editor-${key}`),
        `「${key}」应当渲染专属结构化编辑器`,
      ).toBeVisible();
      // ……且通用自由文本框的锚点**不存在**（这一条才是人类批评的那件事的反证）。
      await expect(
        page.getByTestId(`bp-facet-content-${key}`),
        `「${key}」不应再落回通用自由文本框`,
      ).toHaveCount(0);
      // ……并且原型 <Intro> 那段「这一项是干什么的」解释在真栈里逐字渲染出来了
      // （改造时前 4 项整段丢过、后 11 项各抄一份，见 facet-editor-registry.ts 头注）。
      await expect(
        page.getByTestId(`bp-facet-intro-${key}`),
        `「${key}」应当渲染原型的 intro 解释段`,
      ).toHaveText(FACET_INTRO[key]!);
    }

    // 第 14 项：基本配置聚合页（它不是 designFacetKey，入口 testid 也刻意不同前缀）。
    await page.getByTestId("bp-designer-basic-overview-entry").click();
    await expect(page.getByTestId("bp-basic-overview")).toBeVisible();
    await expect(page.getByTestId("bp-basic-tier")).toBeVisible();
    await expect(page.getByTestId("bp-basic-init-preview")).toBeVisible();
    // 六类恒定：空类也要出现，否则「这次没有分组」与「我们不初始化分组」不可分辨。
    for (const c of ["议程环节", "分组", "角色分工", "材料清单", "会前任务", "画布与产出物"]) {
      await expect(page.getByTestId(`bp-basic-init-category-${c}`)).toBeVisible();
    }
  });

  test("② 挑三项做真实编辑并刷新：值回到原来那一格（真落库），完成度随服务端响应联动", async ({ page }) => {
    test.skip(blueprintId === "", "上一条没建出蓝本");
    await loginAsAdmin(page);
    await page.goto(`/tpl/designer?blueprintId=${blueprintId}`);
    await expect(page.getByTestId("bp-designer-shell")).toBeVisible();

    const before = await page.getByTestId("bp-designer-completeness").textContent();

    // ── 第 1 项：主题与背景（结构化多字段——证明不是拼成一段文本） ──────────
    await page.getByTestId("bp-designer-facet-topic-and-background").click();
    const themeText = `端到端主题 ${scope}`;
    const bgText = `端到端硬约束 ${scope}`;
    const stmt = page.getByTestId("bp-topic-statement-input");
    await stmt.fill(themeText);
    const [put1] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${API}/blueprints/${blueprintId}/design-facets/topic-and-background` &&
          r.request().method() === "PUT",
      ),
      stmt.blur(),
    ]);
    expect(put1.status()).toBe(200);
    const bg = page.getByTestId("bp-topic-bg-content-硬约束");
    await bg.fill(bgText);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${API}/blueprints/${blueprintId}/design-facets/topic-and-background` &&
          r.request().method() === "PUT",
      ),
      bg.blur(),
    ]);

    // 完成度必须来自这次 PUT 的响应（服务端算的），不是前端本地 +1。
    const body1 = await put1.json();
    await expect(page.getByTestId("bp-designer-completeness")).toContainText(
      `${body1.completeness.done}/${body1.completeness.denominator}`,
    );
    expect(await page.getByTestId("bp-designer-completeness").textContent()).not.toBe(before);

    // ── 第 2 项：问卷（增删型结构化：加一份问卷再改名） ─────────────────────
    await page.getByTestId("bp-designer-facet-survey").click();
    const surveyName = `端到端问卷 ${scope}`;
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${API}/blueprints/${blueprintId}/design-facets/survey` &&
          r.request().method() === "PUT",
      ),
      page.getByTestId("bp-survey-add").click(),
    ]);
    const sName = page.getByTestId("bp-survey-name-0");
    await sName.fill(surveyName);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${API}/blueprints/${blueprintId}/design-facets/survey` &&
          r.request().method() === "PUT",
      ),
      sName.blur(),
    ]);

    // ── 第 3 项：场地与形式（roles-and-perms 已按 2026-08-31 产品决策移除，
    //   这一项改绑到「场地与形式」的空间要求文本行，覆盖面不变：仍是「填 → 真实
    //   PUT → 刷新后回显」这条链路，只是换了一个还在的 designFacetKey） ──────
    await page.getByTestId("bp-designer-facet-venue-and-format").click();
    const venueText = `端到端场地要求 ${scope}`;
    const venueField = page.getByTestId("bp-venue-space-主场地");
    await venueField.fill(venueText);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${API}/blueprints/${blueprintId}/design-facets/venue-and-format` &&
          r.request().method() === "PUT",
      ),
      venueField.blur(),
    ]);

    // ── 刷新 = 真落库的判据 ──────────────────────────────────────────────
    await page.reload();
    await expect(page.getByTestId("bp-designer-shell")).toBeVisible();

    await page.getByTestId("bp-designer-facet-topic-and-background").click();
    // 两个字段各自回到自己那一格——证明存的是结构化 JSON，不是拼接文本。
    await expect(page.getByTestId("bp-topic-statement-input")).toHaveValue(themeText);
    await expect(page.getByTestId("bp-topic-bg-content-硬约束")).toHaveValue(bgText);

    await page.getByTestId("bp-designer-facet-survey").click();
    await expect(page.getByTestId("bp-survey-name-0")).toHaveValue(surveyName);

    await page.getByTestId("bp-designer-facet-venue-and-format").click();
    await expect(page.getByTestId("bp-venue-space-主场地")).toHaveValue(venueText);
  });

  test("③ 完成度是服务端派生：已填 3 项，重新进页面时徽标仍是服务端给的数（不是前端记忆）", async ({ page }) => {
    test.skip(blueprintId === "", "上一条没建出蓝本");
    await loginAsAdmin(page);
    await page.goto(`/tpl/designer?blueprintId=${blueprintId}`);
    await expect(page.getByTestId("bp-designer-shell")).toBeVisible();

    // 上一条填了 topic-and-background / survey / venue-and-format 三项。
    const text = (await page.getByTestId("bp-designer-completeness").textContent()) ?? "";
    const m = text.match(/(\d+)\s*\/\s*(\d+)/);
    expect(m, `完成度徽标应形如 n/m，实际是「${text}」`).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(3);
    // 13 = DESIGN_FACET_DEFINITIONS.length（roles-and-perms/group-capabilities 已移除）。
    expect(Number(m![2])).toBe(13);
  });
});
