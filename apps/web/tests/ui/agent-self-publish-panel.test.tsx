/**
 * #660 —— 后台「新建 Agent」面板上的**发布**入口。
 * **⚠⚠ 走的是尚未签核的草案边**（`selfPublishToollessAgent` / `KNOWN_CONTRACT_GAPS.AR11`）。
 *
 * ## 为什么这三条断言值得单独存在
 *
 * R9 的判据是「**靠产品自己的界面**走到这一步」。后端那条路由已经由
 * `apps/api/tests/agent-runtime/create-agent-publish-path.test.ts` 在真实 HTTP 栈上
 * 端到端证明了，本文件只回答界面这一半，而且只挑**会静默骗人**的那几处：
 *
 * ① 请求形状：路径来自契约（`:agentId` 被真实 id 替换），不是前端手写的字符串。
 *    写坏时界面**照样显示"已发布"**，因为成功与否是本地 state 说了算。
 * ② **没有乐观更新**：服务端 422 时界面必须仍然说它是草稿、并原样显示 `reasonCode`。
 *    这一条正是 #660 症状本身的形状——「界面看起来好了、发消息还是 422」。
 * ③ 失败原因**不被翻译成"请重试"**：`AGENT_NOT_TOOLLESS` 要能被用户看见，
 *    否则"这个 agent 有工具所以必须走双人评审"这个真实原因就消失了。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentRuntime } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { AgentDefinitionCreatePanel } from "@/components/admin/agent-definition-create-panel";

const PREFIX = "i660";
const AGENT_ID = "agent-i660-ui";

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 建 agent 恒成功；发布交给 `onPublish` 决定，这样一份夹具能同时测成功与 422。 */
function stubFetch(onPublish: () => Response) {
  const calls: Recorded[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    if (url.pathname === agentRuntime.operations.createAgent.path) {
      return jsonResponse(
        { agentId: AGENT_ID, publishState: "草稿", toolWhitelist: [], cloneFrom: null },
        201,
      );
    }
    return onPublish();
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function createDraft() {
  render(<AgentDefinitionCreatePanel prefix={PREFIX} />);
  fireEvent.click(screen.getByTestId(`${PREFIX}-add`));
  fireEvent.change(screen.getByTestId(`${PREFIX}-add-name`), { target: { value: "我的助手" } });
  fireEvent.change(screen.getByTestId(`${PREFIX}-add-initials`), { target: { value: "WD" } });
  fireEvent.change(screen.getByTestId(`${PREFIX}-add-role`), { target: { value: "帮我整理会议纪要" } });
  fireEvent.click(screen.getByTestId(`${PREFIX}-add-submit`));
  await waitFor(() => expect(screen.getByTestId(`${PREFIX}-publish`)).toBeTruthy());
}

describe("#660 后台面板：草稿建成后有一条发布入口", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-660");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("① 发布按契约打到 /agents/:agentId/self-publish，成功后文案改口为「运行中、可在会话里选用」", async () => {
    const calls = stubFetch(() =>
      jsonResponse(
        {
          agentId: AGENT_ID,
          publishState: "运行中",
          agentVersionId: "agent-version-1",
          publishRoute: "自助发布",
        },
        201,
      ),
    );
    await createDraft();
    fireEvent.click(screen.getByTestId(`${PREFIX}-publish`));

    await waitFor(() =>
      expect(screen.getByTestId(`${PREFIX}-add-notice`).textContent).toContain("已发布"),
    );
    expect(screen.getByTestId(`${PREFIX}-add-notice`).textContent).toContain("会话");
    /* 发布成功后按钮消失——它不是一个可以点第二次的东西（服务端那侧是 AGENT_NOT_DRAFT）。 */
    expect(screen.queryByTestId(`${PREFIX}-publish`)).toBeNull();

    const expectedPath = agentRuntime.operations.selfPublishToollessAgent.path.replace(
      ":agentId",
      AGENT_ID,
    );
    const publishCall = calls.find((c) => c.path === expectedPath);
    expect(publishCall, `发布请求没打到契约声明的路径；实际打过：${calls.map((c) => c.path).join(", ")}`)
      .toBeTruthy();
    expect(publishCall?.method).toBe("POST");
    expect(publishCall?.body).toEqual({ agentId: AGENT_ID });
  });

  it("② 服务端 422 ⇒ 界面**不得**显示已发布，且发布按钮仍在（没有乐观更新）", async () => {
    stubFetch(() => jsonResponse({ reasonCode: "AGENT_NOT_TOOLLESS" }, 422));
    await createDraft();
    fireEvent.click(screen.getByTestId(`${PREFIX}-publish`));

    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-publish-error`)).toBeTruthy());
    expect(screen.getByTestId(`${PREFIX}-add-notice`).textContent).toContain("草稿");
    expect(screen.getByTestId(`${PREFIX}-add-notice`).textContent).not.toContain("已发布");
    expect(screen.getByTestId(`${PREFIX}-publish`)).toBeTruthy();
  });

  it("③ 失败原因原样呈现 reasonCode，不被翻译成「请重试」", async () => {
    stubFetch(() => jsonResponse({ reasonCode: "AGENT_NOT_TOOLLESS" }, 422));
    await createDraft();
    fireEvent.click(screen.getByTestId(`${PREFIX}-publish`));

    await waitFor(() =>
      expect(screen.getByTestId(`${PREFIX}-publish-error`).textContent).toContain(
        "AGENT_NOT_TOOLLESS",
      ),
    );
  });
});
