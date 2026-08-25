import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/**
 * issue #2038 —— 「标准默认 agent」的服务端 org 级动态解析 + env 配错容错。
 *
 * ## 这条 spec 在证什么（devapp 实测事故的机制性反证）
 *
 * devapp 上 `COPILOTKIT_V2_AGENT_ID` 被配成了 `agent_versions.id`（不是 `agents.id`），
 * 未选 agent 的首屏发消息整条轨道 AGENT_NOT_FOUND。修复把默认 agent 的解析权移到
 * 服务端（`copilotkit-agui.controller.ts` 的 `resolveEffectiveAgentId`，有 principal/org
 * 上下文）：手选严格按选；env 值只有在请求方 org 下真实可解析才用；解析不到落 org
 * 动态默认（确定性规则见 `DefaultAgentResolver` 端口文档）；org 一个可跑的都没有才 422。
 *
 * ## 为什么走真实浏览器登录 + 直接 POST `/copilotkit/agui`，而不是再起一个 Next server
 *
 * 「不设 env」和「env 配错」是 webServer 级环境差异——本套件的 Next dev server 把
 * `COPILOTKIT_V2_AGENT_ID` 固定配成**有效值**（`copilotkit-v2-agent-switch.spec.ts`
 * 的向后兼容用例依赖它）。为这两个场景各起一个 Next dev server 首编译要 2-3 分钟
 * （见 agent-switch spec 的实测记录），而 route.ts 这层的三态透传是纯函数
 * （`lib/copilotkit-v2-agent-query.ts`），已有单测钉死三个形状。本 spec 于是打
 * 服务端解析本体：同一条真实登录（真 token）、同一个 Next rewrite（`/copilotkit/:path*`
 * → API，`next.config.mjs`）、真实 Nest + Postgres + deep-agent loopback 替身——
 * 「浏览器侧没有选择、route 层没给出可用值时，服务端真的解析出一个能跑的默认」
 * 这条链路端到端可见，不是 mock 的。
 *
 * ## 默认解析在本套件里落到谁
 *
 * 种子 org 没有 `ensureDefaultAgent` 的「通用助手」（seed 脚本直插表，不走注册路径），
 * 已发布候选是 `agentId`（chat-read-loopback provider）与 `deepAgentId`
 * （deep-agent provider）——确定性规则第②级（deep-agent 优先）命中 `deepAgentId`，
 * 与 env 默认恰好同一个 agent：回复必须带 deep-agent loopback 替身的确定性输出，
 * 且**不带** `[loopback]`（chat-read-loopback 的签名）——两个 provider 的输出结构性
 * 不同，断言不会假阳性。
 */
test.setTimeout(120_000);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function bearer(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return `Bearer ${token}`;
}

/** POST 一轮真实 bridge turn，返回 SSE 原文（run 结束后整条流才会关闭）。 */
async function postAguiTurn(page: Page, query: string, text: string): Promise<{ status: number; body: string }> {
  const authorization = await bearer(page);
  const response = await page.request.post(`/copilotkit/agui${query}`, {
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    data: {
      threadId: crypto.randomUUID(), runId: crypto.randomUUID(),
      messages: [{ id: crypto.randomUUID(), role: "user", content: text }],
    },
    timeout: 60_000,
  });
  return { status: response.status(), body: await response.text() };
}

test("#2038 ①：完全不带 agentId → 服务端按 org 解析动态默认，真实回复（不是 AGENT_NOT_FOUND）", async ({ page }) => {
  await login(page);
  const userText = "默认解析取证：不带任何 agent 标识";
  const { status, body } = await postAguiTurn(page, "", userText);

  expect(status).toBe(200);
  // 反证 A：旧行为（无 agentId → 422/AGENT_NOT_FOUND）已被替换——流里必须没有这个错误码。
  expect(body).not.toContain("AGENT_NOT_FOUND");
  expect(body).toContain("RUN_FINISHED");
  // 反证 B：回复真的来自确定性规则选中的 deep-agent（loopback 替身回显用户原文），
  // 而不是 chat-read-loopback 那个 `[loopback]` 签名的 agent——命中的是第②级排序。
  expect(body).toContain(userText);
  expect(body).not.toContain("[loopback]");
});

test("#2038 ②：env 配错（version id 形状 + agentIdSource=env-default 标记）→ 落动态默认仍能回复", async ({ page }) => {
  await login(page);
  const userText = "容错取证：env 被配成了 version id";
  // devapp 事故的逐字形状：一个 agents 表里不存在的 agent_versions.id。
  const bogus = encodeURIComponent("agent-version-5c3eb303-devapp-misconfig");
  const { status, body } = await postAguiTurn(
    page, `?agentId=${bogus}&agentIdSource=env-default`, userText,
  );

  expect(status).toBe(200);
  expect(body).not.toContain("AGENT_NOT_FOUND");
  expect(body).toContain("RUN_FINISHED");
  expect(body).toContain(userText);
});

test("#2038 ③（反向对照）：用户手选一个跑不了的 agent（无 env-default 标记）→ 仍然诚实报错，零回退", async ({ page }) => {
  await login(page);
  const { status, body } = await postAguiTurn(
    page, `?agentId=${encodeURIComponent("agent-version-5c3eb303-devapp-misconfig")}`,
    "严格路径取证：手选错误 agent 不许被静默换掉",
  );

  // SSE 通道打开、错误在流内——与 `agui-bridge-sse.test.ts` 既有约定一致。
  expect(status).toBe(200);
  expect(body).toContain("AGENT_NOT_FOUND");
  expect(body).not.toContain("RUN_FINISHED");
});
