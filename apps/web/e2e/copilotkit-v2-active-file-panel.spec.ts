import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-13 双栏联动：Chat + 活动文件工作台 —— 证明 `ActiveFilePanel` 真的解析 DA-15
 * 定义的 `file_created`/`file_content_delta` `CUSTOM {name,value}` wire 事件并渲染出
 * 对应内容，不是拿字符串硬拼出来的假 UI。
 *
 * ## 为什么这条 spec 自己注入 CUSTOM 帧，不是等真实后端产生
 *
 * 如实登记（与 `apps/web/lib/agui-file-events.ts`/`copilotkit-v2-panel.tsx` 文件头
 * 同一段结论，单一事实源在那两处，这里不重复论证）：`deepagents` 的
 * `FilesystemMiddleware` 已经真实挂载（`write_file`/`edit_file` 是模型可调用的真实
 * 工具），但它写入的是单次 run 状态内的临时虚拟文件系统，不落 DB；DA-12 的 VFS
 * （`vfs://<attachment|artifact>/<id>`）要求 `id` 是"该 domain 自己权威表里的主键"，
 * VFS 自己不发号、不落库——把 `FilesystemMiddleware` 的临时文件硬套进这两个既有
 * domain 会谎称它们已经落库。`copilotkit-agui.controller.ts` 因此本轮没有新增任何
 * 真实生产 `file_created`/`file_content_delta` 的逻辑（DA-15 自己的契约文件头同一句
 * 原话："目前没有真实生产者"）。
 *
 * 于是这条 spec 验证的是"消费端对协议精确的 wire 字节做了正确的事"，用与
 * `copilotkit-v2-runtime-adapter.spec.ts` 反证③完全同一套机制（`page.route()` +
 * `route.fetch()` 读真实响应的裸字节，在真实 `RUN_FINISHED` 之前插入两个协议合法的
 * `CUSTOM` 帧，`route.fulfill()` 把拼接后的字节原样交给页面）——真实网络往返、真实
 * 鉴权、真实 deep-agent loopback 回复全部照常发生，只有这两个当前没有真实生产者的
 * 事件是本 spec 补的，且补的 `value` 严格按 `@repo/contracts/agui-state-events` 的
 * zod schema 构造（与后端将来真实实现时会发的 wire 形状逐字段一致，不是拍脑袋编的
 * JSON）。这不是给消费端开后门验证一个从不会发生的输入——一旦后续任务把真实生产者
 * 接上，这条 spec 验证过的解析/渲染路径不需要改一行。
 */

const OUT = resolve(process.env.COPILOTKIT_V2_ACTIVE_FILE_PANEL_OUT ?? ".copilotkit-v2-active-file-panel");
test.setTimeout(180_000);

interface AguiFrame { readonly type: string; readonly [key: string]: unknown }

function parseSseFrames(raw: string): AguiFrame[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data:"))
    .map((chunk) => JSON.parse(chunk.slice("data:".length).trim()) as AguiFrame);
}

function serializeSseFrames(frames: readonly AguiFrame[]): string {
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
}

// 同 `copilotkit-v2-runtime-adapter.spec.ts` 文件头：给 `[[...slug]]/route.ts` 的
// 首次编译窗口一次预热，不改运行时代码本身，单独抄一份是因为两个 spec 文件各自
// 独立可跑（不共享 module 级状态）。
async function warmUpCopilotRuntimeRoute(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/copilotkit/info");
        return res.status();
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

const FILE_URI = "vfs://attachment/e2e-active-file-panel-fixture";
const MARKDOWN_FILE_NAME = "release-notes.md";

const FILE_CREATED_FRAME: AguiFrame = {
  type: "CUSTOM",
  name: "file_created",
  value: {
    uri: FILE_URI,
    domain: "attachment",
    name: MARKDOWN_FILE_NAME,
    mime: "text/markdown",
    bytes: null,
    source: "chat_upload",
  },
};

const FILE_CONTENT_DELTA_FRAME_1: AguiFrame = {
  type: "CUSTOM",
  name: "file_content_delta",
  value: { uri: FILE_URI, delta: "# Release notes\n\n", sequence: 0 },
};

const FILE_CONTENT_DELTA_FRAME_2: AguiFrame = {
  type: "CUSTOM",
  name: "file_content_delta",
  value: { uri: FILE_URI, delta: "- DA-13 active file panel", sequence: 1 },
};

test("ActiveFilePanel 真实解析 file_created/file_content_delta wire 帧并渲染右栏", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  const userText = "DA-13 活动文件工作台测试";
  const MAX_ATTEMPTS = 4;
  let succeeded = false;
  let lastFailureNote = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let capturedBody: Buffer | null = null;
    let runOk = false;

    await page.route(
      (u) => u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info",
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        const fetched = await route.fetch();
        runOk = fetched.ok();
        capturedBody = await fetched.body();
        if (!runOk) {
          await route.fulfill({ response: fetched });
          return;
        }
        const wireBody = (capturedBody as unknown as Buffer).toString("utf8");
        const frames = parseSseFrames(wireBody);
        const finishedIdx = frames.findIndex((f) => f.type === "RUN_FINISHED");
        const spliced =
          finishedIdx === -1
            ? [...frames, FILE_CREATED_FRAME, FILE_CONTENT_DELTA_FRAME_1, FILE_CONTENT_DELTA_FRAME_2]
            : [
                ...frames.slice(0, finishedIdx),
                FILE_CREATED_FRAME,
                FILE_CONTENT_DELTA_FRAME_1,
                FILE_CONTENT_DELTA_FRAME_2,
                ...frames.slice(finishedIdx),
              ];
        const splicedBody = serializeSseFrames(spliced);
        writeFileSync(resolve(OUT, `attempt-${attempt}-original-wire.txt`), wireBody, "utf8");
        writeFileSync(resolve(OUT, `attempt-${attempt}-spliced-wire.txt`), splicedBody, "utf8");
        await route.fulfill({
          status: fetched.status(),
          headers: fetched.headers(),
          body: splicedBody,
        });
      },
    );

    await warmUpCopilotRuntimeRoute(page);
    await page.goto("/chat/copilotkit-v2");
    await page.getByTestId("copilotkit-v2-input").fill(userText);
    await page.getByTestId("copilotkit-v2-send").click();

    await expect.poll(() => capturedBody !== null, { timeout: 60_000 }).toBe(true);
    await page.unroute("**/api/copilotkit/**");

    if (!runOk) {
      lastFailureNote = `attempt ${attempt}: run request not ok`;
      continue;
    }

    const panel = page.getByTestId("active-file-panel");
    try {
      await panel.waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      lastFailureNote = `attempt ${attempt}: active-file-panel never appeared`;
      continue;
    }
    succeeded = true;
    break;
  }

  expect(succeeded, `all ${MAX_ATTEMPTS} attempts failed; last: ${lastFailureNote}`).toBe(true);

  /* ── 反证① tab 列表：一个文件、名字与 file_created 的 name 字段一致 ── */
  const panel = page.getByTestId("active-file-panel");
  await expect(panel).toHaveAttribute("data-active-file-count", "1");
  const tab0 = page.getByTestId("active-file-tab-0");
  await expect(tab0).toContainText(MARKDOWN_FILE_NAME);
  await expect(tab0).toHaveAttribute("data-active-file-tab-selected", "true");

  /* ── 反证② 内容真的按 sequence 顺序累加了两条 delta，markdown 走 MarkdownMessage
   *    渲染管线（`# Release notes` 渲成标题，不是原样带 `#` 的纯文本） ── */
  const content = page.getByTestId("active-file-content");
  await expect(content).toContainText("Release notes");
  await expect(content).toContainText("DA-13 active file panel");

  await page.screenshot({ path: resolve(OUT, "active-file-panel-rendered.png") });
});

test("ActiveFilePanel 缺席纪律：没有 file_created 事件时右栏不渲染", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat/copilotkit-v2");

  // 没有发送任何消息、没有任何 CUSTOM 帧到达——面板不应该以任何形式出现在 DOM 里
  // （不是"隐藏但存在"，是根本不渲染，见 `ActiveFilePanel` 自己的"缺席"纪律）。
  await expect(page.getByTestId("active-file-panel")).toHaveCount(0);
});
