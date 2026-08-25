import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19f —— `useCopilotReadable`/`useAgentContext` 接线基座（issue TBD，见 PR）。
 *
 * 只证明一件事：`copilotkit-v2-providers.tsx` 里挂的 `useAgentContext` 探针
 * （`CopilotKitV2ReadableContextProbe`，注入固定标记字符串
 * `DA-19F-READABLE-CONTEXT-PROBE` + 当前 `pathname`）真的到达了打给 CopilotRuntime
 * 的 `POST /api/copilotkit/agent/default/run` 请求体——不是"hook 调了没报错"，是
 * 读裸请求体字节、反序列化、断言字段值。
 *
 * ## 为什么用 `page.route()` + `route.fetch()` 读请求体，不用 `page.waitForRequest`
 *
 * `copilotkit-v2-runtime-adapter.spec.ts`（DA-19，#1967/#1968）已经踩过这个坑并
 * 记录在案：`page.waitForRequest` 拿到的 `Request` 对象本身没问题（`.postData()`
 * 就够用），但这个 spec 同时要读**响应**确认没有把整条请求打挂（用 `/info` 预热 +
 * 200 状态码代替，不需要解析 SSE 帧——那部分字节级正确性已经由 DA-19 那条 spec
 * 证明过，本条不重复断言"回复文字对不对"，只断言"上行请求体里有没有注入值"）。
 * 沿用 `route.fetch()` 是为了和 DA-19 那条 spec 用同一套抓包机制，避免维护两种
 * 不同的取证方式。
 *
 * ## 范围边界
 *
 * 本 spec 不断言"注入的探针值影响了 agent 的回复内容"——那需要 loopback 替身
 * 感知并回显 `context` 字段，属于另一个层面的验证，且会引入"改回显脚本"这种
 * 超出 DA-19f 范围的改动。DA-19f 的权威范围是"接线本身通不通"，wire 层能看到
 * 注入值 = 通。
 */

const OUT = resolve(process.env.COPILOTKIT_V2_AGENT_CONTEXT_OUT ?? ".copilotkit-v2-agent-context");
test.setTimeout(180_000);

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

test("useAgentContext 探针真的出现在 /api/copilotkit/agent/:id/run 的上行请求体里", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  const userText = "DA-19f useAgentContext 接线基座取证";

  // 与 DA-19（copilotkit-v2-runtime-adapter.spec.ts）同一个已知限制②：`@copilotkit/
  // react-core/v2` 极少数渲染时序下会用空 headers 构造第一次 run，拿到 401、请求体
  // 仍然会被发出（只是被服务端拒绝）。context 字段是否存在与鉴权成败无关——只要
  // 抓到一次上行请求体即可判定，不需要重试到"回复成功"，但仍保留少量重试防止抓包
  // 本身因页面刷新时序错过那一次请求。
  const MAX_ATTEMPTS = 3;
  let requestBody = "";
  let runUrl = "";
  let captured = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !captured; attempt += 1) {
    await page.route(
      (u) => u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info",
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        requestBody = route.request().postData() ?? "";
        runUrl = route.request().url();
        const fetched = await route.fetch();
        await route.fulfill({ response: fetched });
      },
    );

    await warmUpCopilotRuntimeRoute(page);
    await page.goto("/chat");
    await page.getByTestId("copilotkit-v2-input").fill(userText);
    await page.getByTestId("copilotkit-v2-send").click();

    captured = await expect
      .poll(() => requestBody.length > 0, { timeout: 30_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    await page.unroute("**/api/copilotkit/**");
  }

  // 实测（本轮）：偶尔会有第二条打向同一 pattern 的请求（`useAgent`/`AgentRegistry`
  // 自身的重试或探测）在我们已经拿到 `requestBody` 之后才发出，`page.unroute()` 只
  // 阻止*未来*匹配，不取消已经进了 handler、仍在 `await route.fetch()` 的那一次——
  // 测试断言全部通过后，context 关闭会让那次 `route.fetch()` 抛
  // `"Test ended"`，Playwright 把它记成一条与任何 test 都不挂钩的顶层 error，让
  // 整个进程以非零退出码收尾（即使这条 spec 本身的 `✓` 已经打出来）。
  // `unrouteAll({ behavior: "ignoreErrors" })` 是 Playwright 自己给这条错误信息
  // 建议的修法：吞掉仍在飞行中的那次 handler 的错误，不影响已经做完的断言。
  await page.unrouteAll({ behavior: "ignoreErrors" });

  expect(captured, "从未抓到一条打向 /api/copilotkit/agent/:id/run 的 POST 请求").toBe(true);
  expect(runUrl).toContain("/api/copilotkit/");

  writeFileSync(resolve(OUT, "run-request-body.json"), requestBody, "utf8");

  const requestJson = JSON.parse(requestBody) as {
    context?: readonly { description?: string; value?: unknown }[];
  };
  writeFileSync(
    resolve(OUT, "parsed-context-field.json"),
    JSON.stringify(requestJson.context ?? null, null, 2),
    "utf8",
  );

  expect(Array.isArray(requestJson.context), "请求体里没有 context 字段——hook 没接上").toBe(true);

  const probeEntry = (requestJson.context ?? []).find((entry) => {
    if (typeof entry.value !== "string") return false;
    return entry.value.includes("DA-19F-READABLE-CONTEXT-PROBE");
  });

  expect(
    probeEntry,
    `context 字段存在但没有找到探针值；实际 context=${JSON.stringify(requestJson.context)}`,
  ).toBeTruthy();

  // 探针 value 是 `useAgentContext` 经 `JSON.stringify` 序列化后的字符串（见
  // `@copilotkit/core` context-store 头注 + agent-access.md「HIGH — Registering
  // non-serializable values」一节），里面应同时带上当前路由 pathname。
  const parsedValue = JSON.parse((probeEntry as { value: string }).value) as {
    pathname?: string;
    probe?: string;
  };
  expect(parsedValue.probe).toBe("DA-19F-READABLE-CONTEXT-PROBE");
  expect(parsedValue.pathname).toBe("/chat");
});
