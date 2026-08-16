/**
 * #520 —— 核心闭环第 3 步「**新增** Skill」的**真实浏览器**门控。
 *
 * ⚠ **F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598，
 * 2026-08-16 已签核）之后**：本文件原来证的「完全新建（契约表单）→ 刷新后仍在
 * PostgreSQL」这整条闭环已经**不存在**——`POST /skills` 现在对任何请求恒 410，
 * `/skill` 库屏也不再有「完全新建」入口。原来的持久化反证（乐观插入 → reload 后
 * 露馅）以及「重名 409」失败态反证都建立在「这条写路径能成功一次」这个前提上，
 * 前提没了，反证本身也失去了意义。
 *
 * 本文件因此改为真实浏览器反证 **F192 本身**：链路一节不许省——Chromium → Next
 * 同源代理 → `SkillController.create`（真实返回 410，不是本地 mock）：
 *
 * ① **入口不可达**：打开 `/skill`，点「新建 skill」，DOM 里没有任何「完全新建」
 *    面板/按钮/字段（同组件测试 `skill-catalog-no-create-panel.test.tsx`，但这里
 *    是真实浏览器 + 真实渲染，不是 jsdom）。
 * ② **写入口真的关了**：在浏览器页面上下文里直接对 `POST /skills` 发一次真实请求
 *    （走同源代理 → 真实 `SkillController`），断言 410，不是本地 stub。
 * ③ **默认落在真实可达的路径上**：弹窗默认 tab 是「从 GitHub 导入」，
 *    `SkillUrlImportPanel` 真的渲染出来了，不是一片空白。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：那个文件的每一条 `page.goto`
 *   都被 `.harness/scripts/fullstack-smoke.test.ts` 按出现次数钉死（#387 的反空转手段）。
 *   本文件与 #387 / #458 / #496 共用同一套 webServer 与同一个库，串行执行。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";
const CREATE_PATH = `${API}/skills`;

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openSkillCatalog(page: Page) {
  await page.goto("/skill");
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();
}

test("F192 · /skill 库屏没有「完全新建」入口，弹窗默认落在真实可达的导入路径上", async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  await loginAsAdmin(page);
  await openSkillCatalog(page);

  await page.getByTestId("skill-create-open").click();
  const dialog = page.getByTestId("skill-create-modal");
  await expect(dialog).toBeVisible();

  // 这些 testid 曾经是「完全新建（契约表单）」面板的入口/字段——真实浏览器里也不该出现。
  await expect(page.getByTestId("skill-create-panel")).toHaveCount(0);
  await expect(page.getByTestId("skill-create-mode-form")).toHaveCount(0);
  await expect(page.getByTestId("skill-create-name")).toHaveCount(0);
  await expect(page.getByTestId("skill-create-submit")).toHaveCount(0);

  // 只剩两条路径。
  await expect(page.getByTestId("skill-create-mode-import")).toBeVisible();
  await expect(page.getByTestId("skill-create-mode-market")).toBeVisible();

  // 默认落在「从 GitHub 导入」——真实可达，不是一片空白。
  await expect(page.getByTestId("skill-create-mode-import")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("skill-url-import-panel")).toBeVisible();

  expect(failures).toEqual([]);
});

test("F192 · POST /skills 对真实已认证会话恒 410（不是本地 stub，走同源代理到真实 SkillController）", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openSkillCatalog(page);

  // 在页面上下文里直接发请求：复用浏览器已建立的真实会话 cookie/凭据，
  // 走的是同一条同源代理 → 真实 `SkillController.create`，不是测试进程自己拼的 fetch。
  const result = await page.evaluate(
    async ({ path }) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: "org-does-not-matter-its-410-regardless",
          name: "F192 真实浏览器反证",
          duty: "d",
          contract: {
            promptTemplate: "p",
            inputSchema: "{}",
            outputSchema: "{}",
            dataScope: [],
            readsRawTranscript: false,
            fallbackDeclaration: "f",
          },
          visibility: "org-wide",
          modelRef: "model-default",
        }),
      });
      const body = (await response.json()) as { reasonCode?: string };
      return { status: response.status, reasonCode: body.reasonCode };
    },
    { path: CREATE_PATH },
  );

  expect(result.status).toBe(410);
  expect(result.reasonCode).toBe("SKILL_DRAFT_WRITE_PATH_FROZEN");
});
