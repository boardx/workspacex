import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-17（UX-9 Line D3）—— 证明 D2（#1842）已经在发的 AG-UI `STATE_SNAPSHOT` 事件，
 * 真的被前端解析并驱动了 `AgentPlanPanel` 的渲染，而不是从 `toolArgsSummary` 猜的。
 *
 * ## 为什么打 `/chat/copilotkit-preview`，不是生产聊天页 `/chat`
 *
 * `STATE_SNAPSHOT` 是 AG-UI 协议命名空间的事件，目前唯一会真正建立 AG-UI 连接
 * （`@ag-ui/client` 的 `HttpAgent` 打 `POST /copilotkit/agui`）的前端入口就是
 * `copilotkit-preview-panel.tsx`——生产聊天页 `chat-live-message-panel.tsx` 走的是完全
 * 不同的 `/agent-runs` 轮询 + SSE 通道（`{type:"delta"|"final"}` 帧形状，见
 * `agent-run-stream.ts` 文件头），从不建立 AG-UI 连接，永远不会收到这个事件——这是
 * 当前接线范围如实的边界，不是本 spec 选错了页面。
 *
 * ## 双重反证，缺一不可
 *
 * 1. **上行/下行都留证**：请求体（发给后端的 `RunAgentInput`）与响应体（`text/event-stream`
 *    的原始字节）都落盘到 `${OUT}/`，wire 上逐帧解析出 `STATE_SNAPSHOT`，断言它的
 *    `snapshot.todos` 形状与 loopback 替身（`loopback-deep-agent-provider.ts`）写死的
 *    payload 一致——不是猜后端发了什么，是读真实字节。
 *
 *    ⚠ 读字节用 `response.body()`（原始 `Buffer`）手动 `toString("utf8")`，不用
 *    Playwright 的 `response.text()`：本控制器的 `Content-Type: text/event-stream`
 *    没带 `charset`，Playwright 经 CDP 拿到的 `response.text()` 在这种情况下把响应体
 *    当 Windows-1252 解码再转回 UTF-8 字符串，中文内容全部乱码（本轮实测踩到、已用
 *    `response.body()` 修正——**这是测试抓取方式的问题，不是产品行为的问题**：下面
 *    第③条反证里页面自己截的图，中文渲染完全正常，因为浏览器页面内 `HttpAgent`
 *    读流走的是 `TextDecoder`，默认按 UTF-8 解码，不受 CDP 这条边带路径的影响）。
 * 2. **前端真的渲染了它，且只能是它**：`copilotkit-preview-panel.tsx` 传给
 *    `AgentPlanPanel` 的 `steps` 恒为 `[]`（这个面板没有 `AgentRunView.steps`，见
 *    该行注释），`derivePlanTodos([])` 必然是 `null`——所以如果 `agent-plan-panel`
 *    testid 渲染出来了，唯一可能的数据源就是 `stateSnapshotTodos`，即
 *    `useAguiPlanTodos` 消费 `onStateSnapshotEvent` 的产物。这不是巧合关联，是
 *    这条路径上代码结构本身排除了另一种解释。
 */

const OUT = resolve(process.env.COPILOTKIT_AGUI_STATE_SNAPSHOT_OUT ?? ".copilotkit-agui-state-snapshot");
test.setTimeout(120_000);

interface AguiFrame { readonly type: string; readonly [key: string]: unknown }

function parseSseFrames(raw: string): AguiFrame[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data:"))
    .map((chunk) => JSON.parse(chunk.slice("data:".length).trim()) as AguiFrame);
}

test("STATE_SNAPSHOT 事件真实驱动 AgentPlanPanel 渲染（不是 toolArgsSummary 猜的）", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  /* ── 登录：种子测试账号，零人工输入（同 chat-behavior-shots.spec.ts） ── */
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  /* ── AG-UI 预览面板：真实 HttpAgent 打真实 /copilotkit/agui ────────── */
  await page.goto("/chat/copilotkit-preview");
  await page.getByTestId("copilotkit-preview-agent-id").fill(CHAT_READ_E2E.deepAgentId);
  await page.getByTestId("copilotkit-preview-input").fill("现在几点？");

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/copilotkit/agui") && r.request().method() === "POST",
      { timeout: 60_000 },
    ),
    page.getByTestId("copilotkit-preview-send").click(),
  ]);

  const requestBody = response.request().postData() ?? "";
  // `response.text()` 在这条无 charset 的 `text/event-stream` 上会把中文乱码——见文件头注。
  const wireBody = (await response.body()).toString("utf8");
  writeFileSync(resolve(OUT, "request-body.json"), requestBody, "utf8");
  writeFileSync(resolve(OUT, "wire-sse-raw.txt"), wireBody, "utf8");

  /* ── 反证① 上行：真的打了 /copilotkit/agui，agentId 是我们要的那个 ──── */
  expect(response.url()).toContain(`agentId=${encodeURIComponent(CHAT_READ_E2E.deepAgentId)}`);
  const requestJson = JSON.parse(requestBody) as { messages?: readonly { role: string; content: string }[] };
  expect(requestJson.messages?.some((m) => m.role === "user" && m.content === "现在几点？")).toBe(true);

  /* ── 反证② 下行：wire 上真的有 STATE_SNAPSHOT 帧，形状对得上 loopback 替身写死的 payload ── */
  const frames = parseSseFrames(wireBody);
  const stateSnapshotFrames = frames.filter((f) => f.type === "STATE_SNAPSHOT");
  writeFileSync(
    resolve(OUT, "state-snapshot-frames.json"),
    JSON.stringify(stateSnapshotFrames, null, 2),
    "utf8",
  );
  expect(stateSnapshotFrames.length).toBeGreaterThan(0);

  const lastSnapshot = stateSnapshotFrames[stateSnapshotFrames.length - 1]!.snapshot as {
    todos: readonly { content: string; status: string }[];
  };
  // loopback-deep-agent-provider.ts 默认剧本写死的 write_todos payload（非多步/markdown/
  // 失败触发词时）：三态齐全，与本 spec 无关的另一份事实不重复声明，逐字比对即可。
  expect(lastSnapshot.todos).toEqual([
    { content: "理解用户问题", status: "completed" },
    { content: "查询当前时间", status: "in_progress" },
    { content: "组织最终回答", status: "pending" },
  ]);

  /* ── 反证③ 前端渲染：AgentPlanPanel 真的出现了，且只能来自 stateSnapshotTodos
   *    （见文件头：这个面板传的 steps 恒为 []，derivePlanTodos([]) 必然是 null） ── */
  const planPanel = page.getByTestId("agent-plan-panel");
  await planPanel.waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: resolve(OUT, "state-snapshot-drives-plan-panel.png") });

  expect(await planPanel.getAttribute("data-plan-total")).toBe(String(lastSnapshot.todos.length));
  expect(await planPanel.getAttribute("data-plan-done")).toBe(
    String(lastSnapshot.todos.filter((t) => t.status === "completed").length),
  );
  for (let i = 0; i < lastSnapshot.todos.length; i += 1) {
    const item = page.getByTestId(`agent-plan-item-${i}`);
    await expect(item).toHaveAttribute("data-plan-status", lastSnapshot.todos[i]!.status);
    await expect(item).toContainText(lastSnapshot.todos[i]!.content);
  }
});
