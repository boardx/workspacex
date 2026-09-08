import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";
import { revokeAllStandingToolGrants } from "./standing-tool-grant-cleanup";

const OUT = resolve(process.env.COPILOTKIT_V2_HITL_OUT ?? ".copilotkit-v2-hitl");
test.setTimeout(150_000);

/**
 * issue #3072 ③ / #3068 —— 本文件的 forever 用例点一次「以后都允许」，就往**共享**的
 * chat-read e2e 组织写下一条 `scope='forever'`、跨 run、无过期的授权；此后同组织所有
 * 同类调用被 `hasGrant` 自动放行，`copilotkit-v2-uiux-shots.spec.ts` 的审批弹层截图
 * 用例再也等不到 `chat-tool-permission-dialog`（页面直接是「正在执行技能脚本」）。
 *
 * 收尾走 PR #3075 的产品端点撤销（列出 → 逐条 DELETE，组织 admin 身份），不直连库——
 * `tool_permission_grants` 只授 SELECT/INSERT，这也是 coordinator 在 #3072 的裁决。
 *
 * 放在 `afterEach`（而不是 forever 用例末尾的一行）的理由：用例在点击之后、断言之中
 * 失败时授权**已经写下**，那正是最需要清掉的一次；只有 afterEach 覆盖得到失败路径。
 * 其余用例（once/deny/刷新）本来就不写常驻授权，对它们这一步是空操作。
 */
test.afterEach(async ({ baseURL }) => {
  await revokeAllStandingToolGrants(baseURL!);
});

type PendingRun = { runId: string; threadId: string; status: string; pendingApproval: { permissionRequestId: string; toolName: string; argsSummary: string | null } };
async function triggerApproval(page: Page): Promise<{ run: PendingRun; runUrl: string; headers: Record<string, string> }> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
  await expect.poll(async () => (await page.request.get("/api/copilotkit/info")).status(), { timeout: 60_000 }).toBe(200);
  await page.goto("/chat");
  const pendingResponse = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    const body = await response.json();
    return body.status === "awaiting_tool_permission" && Boolean(body.pendingApproval?.permissionRequestId);
  }, { timeout: 60_000 });
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const response = await pendingResponse;
  const run = await response.json() as PendingRun;
  await expect(page.getByTestId("restored-run-approval")).toBeVisible({ timeout: 30_000 });
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  return { run, runUrl: response.url(), headers: { Authorization: `Bearer ${token}` } };
}

/**
 * issue #3000（C 类根因）—— 四选一按钮**不在** `restored-run-approval` section 里面。
 *
 * `call_skill` 的审批走 `restored-run-approval.tsx` 末尾那条 fallback 分支：四选一卡片
 * （`ToolPermissionCard`）被包进 Radix `Dialog`，`permissionOpen` 初值 `true`（挂载即打开，
 * TW-A11Y-5），而 `DialogContent` 是 **portal 到 `body`** 的——它在 DOM 上不是那个 section
 * 的后代。原来把 locator 锚在 section 上，因此四个按钮一个都找不到（:60 在第一个按钮上
 * 报 `element(s) not found`，:70/:76/:89 直接在 `decide()` 的 click 上耗满 150s）。
 * section 本身是可见的——`triggerApproval()` 里那句 `toBeVisible` 一直是通过的，所以
 * 「服务端产出了但 UI 完全没渲染」这个旧结论不成立。
 *
 * 改锚到审批弹窗，并按组件自己声明的 `data-testid` 定位四个选项
 * （`tool-permission-card.tsx`：`perm-once` / `perm-run` / `perm-always` / `perm-deny`）——
 * 展示文案改过一次（`本任务内允许` → `本 run 内都允许`），判据不该跟着文案漂移。
 */
const APPROVAL_DIALOG = "chat-tool-permission-dialog";
const DECISION_TESTID = { once: "perm-once", run: "perm-run", forever: "perm-always", deny: "perm-deny" } as const;
function decisionButton(page: Page, choice: keyof typeof DECISION_TESTID) {
  return page.getByTestId(APPROVAL_DIALOG).getByTestId(DECISION_TESTID[choice]);
}

async function decide(page: Page, run: PendingRun, decision: "once" | "forever" | "deny"): Promise<void> {
  const response = page.waitForResponse((value) => value.request().method() === "POST" && value.url().includes(`/agent-runs/${run.runId}/permission-requests/${run.pendingApproval.permissionRequestId}/decision`));
  await decisionButton(page, decision).click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect(result.request().postDataJSON()).toEqual({ decision });
  expect(await result.json()).toEqual({ runId: run.runId, permissionRequestId: run.pendingApproval.permissionRequestId });
  await expect(page.getByTestId("restored-run-approval")).toHaveCount(0);
}

async function assertCompleted(page: Page, runUrl: string, headers: Record<string, string>, text: string): Promise<void> {
  await expect.poll(async () => {
    const response = await page.request.get(runUrl, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json()).status;
  }, { timeout: 60_000 }).toBe("succeeded");
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text, { timeout: 30_000 });
  const journal = await page.request.get(`${runUrl}/execution-events?afterSeq=-1`, { headers });
  expect(journal.ok()).toBe(true);
  const events = (await journal.json()).events as Array<{ kind: string; status?: string; toolName?: string }>;
  expect(events.some((event) => event.kind === "tool_start" && event.toolName === DEEP_AGENT_HITL_TOOL_NAME)).toBe(true);
  expect(events.some((event) => event.kind === "status" && event.status === "failed")).toBe(false);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${new URL(runUrl).pathname.split("/").at(-1)}-journal.json`), JSON.stringify(events, null, 2));
}

test("once：常显四选一审批，服务端恢复同一任务并完成", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  // 四选一齐全（授权范围三档 + 拒绝），且四个都真的可见可点——不是只渲染出一个 section。
  for (const choice of ["once", "run", "forever", "deny"] as const) await expect(decisionButton(page, choice)).toBeVisible();
  expect(run.pendingApproval.toolName).toBe(DEEP_AGENT_HITL_TOOL_NAME);
  await expect(page.getByTestId(APPROVAL_DIALOG)).toContainText("quarterly-report");
  await decide(page, run, "once");
  await assertCompleted(page, runUrl, headers, "已按原参数执行");
});

test("deny：拒绝技能后任务调整继续，不变成HITL_REJECTED失败", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  await decide(page, run, "deny");
  await assertCompleted(page, runUrl, headers, "已按你的选择跳过这次技能调用");
});

test("刷新等待审批：恢复同一请求身份，批准后REST流式恢复最终回答", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  await page.reload();
  await expect(page.getByTestId("restored-run-approval")).toBeVisible({ timeout: 60_000 });
  const restored = await (await page.request.get(runUrl, { headers })).json() as PendingRun;
  expect(restored.pendingApproval.permissionRequestId).toBe(run.pendingApproval.permissionRequestId);
  await decide(page, run, "once");
  await assertCompleted(page, runUrl, headers, "已按原参数执行");
  // Replaying an old approval must never act on a later request.
  const stale = await page.request.post(`${runUrl}/permission-requests/${run.pendingApproval.permissionRequestId}/decision`, { headers, data: { decision: "once" } });
  expect(stale.status()).toBe(409);
});

test("forever：真实持久审批端口发送契约forever而非展示文案always", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  await decide(page, run, "forever");
  await assertCompleted(page, runUrl, headers, "已按原参数执行");
});
