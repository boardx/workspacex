import { expect, test } from "@playwright/test";
import { interviewMarkdown } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** No page.route: the login, saved source and reload cross the real API and PostgreSQL. */
test("failed upload and denied microphone preserve Markdown through a saved interview", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/u);
  await page.goto("/itv/new");

  const demand = "# 夜班交接研究\n\n## 研究目标\n核对护理人员最近一次交接班的真实困难。";
  const creation = page.getByRole("dialog", { name: "新建访谈" });
  await creation.getByRole("textbox", { name: "访谈名称" }).fill("夜班交接失败恢复验收");
  await creation.getByRole("button", { name: "开始访谈" }).click();
  await expect(page).toHaveURL(/\/itv\/[^/]+\/intake$/u);
  const editor = page.getByRole("textbox", { name: "研究需求 Markdown" });
  await editor.fill(demand);
  await page.getByLabel("导入研究文件").setInputFiles({
    name: "超限需求.md", mimeType: "text/markdown", buffer: Buffer.alloc(3 * 1024 * 1024 + 1, 65),
  });
  await expect(page.getByRole("alert").filter({ hasText: "研究文件不能超过同步提取上限" })).toBeVisible();
  await expect(editor).toHaveValue(demand);

  // Fullstack Chromium auto-approves its fake microphone even when the permission
  // state is denied. Inject only the browser capture failure; auth, API and DB stay real.
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => { throw new DOMException("Permission denied", "NotAllowedError"); },
    });
  });
  await page.getByRole("button", { name: "语音输入" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "麦克风权限被拒绝" })).toBeVisible();
  await expect(editor).toHaveValue(demand);
  await expect(editor).toBeEnabled();
  await page.getByRole("button", { name: "下一步：确认分析" }).click();
  await expect(page).toHaveURL(/\/itv\/[^/]+\/analysis$/u);

  const interviewId = new URL(page.url()).pathname.split("/")[2]!;
  const token = await page.evaluate(() => window.localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const response = await page.request.get(`/__fullstack_api/interviews/digital/${encodeURIComponent(interviewId)}/markdown`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await response.json());
  expect(source.documents.find((document) => document.step === "intake")?.markdown).toBe(demand);
  await page.goto(`/itv/${encodeURIComponent(interviewId)}/intake`);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue(demand);
});
