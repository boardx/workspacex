import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #3347 —— 右侧「资源 / 材料」页签的**拖拽上传**真实浏览器取证。
 *
 * ## 断言落在哪
 * 「**那个文件真的完成了上传，并且真的出现在材料列表里**」——真实 multipart 打到
 * `POST /chat/threads/:id/attachments`（201）→ 随消息发出（`attachmentIds` 原子挂接，
 * `message_id` 从 NULL 变成该消息）→ 右栏「材料」列表出现该文件名（数据来自
 * `listThreadAttachments`，它**只列 `message_id IS NOT NULL` 的行**）。
 *
 * 刻意**不**把判据放在「drop 事件触发了」「出现了高亮虚线框」上：#3347 原文点名这两种
 * 断言在功能坏掉时无法被证伪——落区高亮完全可以照亮而文件哪都没去（本仓刚修过一批
 * 「点了没反应」：#3311 通知点击、#3317 重试按钮）。
 *
 * ## 与 #3346 的关系
 * 这条链的后半段（pending → 随消息发出）正是 #3346 在查的那一段。本 spec 不去修它，
 * 但**共用同一条链**：右栏拖进来的文件和 📎 选的文件进的是同一条 pending 队列
 * （`chat_message_attachments` 里 `message_id IS NULL` 的同一批行），没有第二套存储。
 * 若 #3346 证实"附件没随消息走"，本 spec 会和它一起红——这是对的，不该各修各的。
 *
 * ## 可见性用命中测试判，不用几何
 * `getBoundingClientRect` 读不出 overflow 裁剪（本仓栽过：几何全绿而用户看不见），
 * 所以「材料条目可见」用 `document.elementFromPoint` 命中测试确认。
 */

test.setTimeout(180_000);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/** 同 `copilotkit-v2-right-panel.spec.ts`：先把 CopilotRuntime 路由焐热。 */
async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

/** 同上——`/chat/[threadId]` 动态段的 Next dev 按需编译焐热（既有对策，非新发明）。 */
async function warmUpThreadRoute(page: Page): Promise<void> {
  await page.goto("/chat/warmup-route-compile-only");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
}

/**
 * 真·拖拽落文件。Playwright 没有"把本地文件拖进页面"的原生 API，标准做法是在页面里
 * 构造 `DataTransfer` + `File` 后派发 dragenter/dragover/drop——这与浏览器真实投递给
 * 落区的事件形状一致（`dataTransfer.files` 里是真 `File`），而不是直接去调组件回调。
 */
async function dropFileOnto(page: Page, testId: string, name: string, content: string): Promise<void> {
  await page.getByTestId(testId).evaluate((target, payload) => {
    const dt = new DataTransfer();
    dt.items.add(new File([payload.content], payload.name, { type: "text/plain" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, { name, content });
}

/** 拖入**非文件**（纯文本 / 链接）：`dataTransfer.files` 为空，这是真实浏览器的形状。 */
async function dropTextOnto(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((target) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "https://example.com/not-a-file");
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  });
}

const FILE_NAME = "materials-drop-fixture.txt";
const FILE_CONTENT = "issue #3347 右栏拖拽上传取证附件。";

test("issue #3347：拖文件到右栏「材料」→ 真实上传 → 随消息发出后出现在材料列表", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat");

  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();

  const inspector = page.getByTestId("chat-task-workbench-inspector");
  await expect(inspector).toBeVisible();

  /* ═══════ ① 拖进来的不是文件：明确说明，且**没有**发出任何上传请求 ═══════ */
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/chat\/threads\/[^/]+\/attachments$/.test(new URL(request.url()).pathname)) {
      uploads += 1;
    }
  });
  await dropTextOnto(page, "chat-task-workbench-inspector");
  await expect(page.getByTestId("chat-materials-upload-notice")).toContainText("只支持拖入文件");
  expect(uploads, "拖非文件不该触发任何上传请求").toBe(0);

  /* ═══════ ② 拖真文件：真实 multipart 上传落在本线程上 ═══════ */
  const uploadResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && /\/chat\/threads\/[^/]+\/attachments$/.test(new URL(response.url()).pathname)
  ));
  await dropFileOnto(page, "chat-task-workbench-inspector", FILE_NAME, FILE_CONTENT);
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  expect(new URL(uploadResponse.url()).pathname).toContain(`/chat/threads/${threadId}/attachments`);

  // 落在右栏任意位置都算数，并自动切到「材料」页签把结果亮出来。
  await expect(inspector).toHaveAttribute("data-active-tab", "materials");
  // 「已加入下一条消息的附件：N 个」只在服务端真的回了 id 之后才 +1。
  await expect(page.getByTestId("chat-materials-pending-count")).toContainText("1 个");

  /* ═══════ ③ 随消息发出 → 材料列表真的出现该文件 ═══════ */
  await page.getByTestId("copilotkit-v2-input").fill("请看这份拖进来的材料");
  await page.getByTestId("copilotkit-v2-send").click();
  await page.getByTestId("chat-task-workbench-inspector-tab-materials").click();
  const materialEntry = page.getByTestId("chat-materials-panel").getByText(FILE_NAME, { exact: false });
  await expect(materialEntry).toBeVisible({ timeout: 60_000 });

  /* ═══════ ④ 命中测试：条目真的在屏幕上被点得到，不是被 overflow 裁掉 ═══════ */
  const hit = await materialEntry.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top !== null && (top === el || el.contains(top) || top.contains(el));
  });
  expect(hit, "材料条目中心点必须真的命中它自己（几何在框里但被裁掉时这条会红）").toBe(true);

  /* ═══════ ⑤ 刷新后仍在：证明它落在 `chat_message_attachments` 里、message_id 已挂 ═══════ */
  await page.reload();
  await page.getByTestId("chat-task-workbench-inspector-tab-materials").click();
  await expect(page.getByTestId("chat-materials-panel")).toContainText(FILE_NAME, { timeout: 60_000 });
});
