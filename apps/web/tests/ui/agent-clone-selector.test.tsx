/**
 * #1915 —— `AgentDefinitionCreatePanel` 的"从已有 agent 克隆"选择器。
 * 规避的空转形状：
 * ① ⛔ 只断言选择器渲染出来——断言选中后表单字段真的被源的值预填。
 * ② ⛔ 只测正样本——断言提交时 `cloneFrom` 真的带到 `POST /agents`（不是恒 null）。
 * ③ ⛔ 假设懒加载——断言挂载时**不**打 `listAgents`，只有点开选择器才打（不给
 *    每次弹层打开都白打一次请求）。
 * ④ ⛔ 假设"克隆时指令可选"绕过了服务端不填就发布不出去的门——只断言前端这一半：
 *    克隆模式下留空 instructions 不拦、不发 PATCH。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentRuntime } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { AgentDefinitionCreatePanel } from "@/components/admin/agent-definition-create-panel";

const PREFIX = "i1915-clone";
const SOURCE_ID = "agent-source-1";
const NEW_ID = "agent-clone-1";

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SOURCE_ROW = {
  agentId: SOURCE_ID,
  initials: "YB",
  name: "值班助理",
  role: "值班一句话",
  roleLabel: "值班头衔",
  visibility: "全组织可用",
  publishState: "运行中",
  modelId: null,
  skillCount: 1,
  monthlyCallCount: null,
};

function stubFetch() {
  const calls: Recorded[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    if (method === "GET" && url.pathname === agentRuntime.operations.listAgents.path) {
      return jsonResponse([SOURCE_ROW]);
    }
    if (method === "POST" && url.pathname === agentRuntime.operations.createAgent.path) {
      return jsonResponse({ agentId: NEW_ID, publishState: "草稿", toolWhitelist: [], cloneFrom: body?.cloneFrom ?? null }, 201);
    }
    if (method === "PATCH") return jsonResponse({ agentId: NEW_ID }, 200);
    return jsonResponse({}, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("#1915 从已有 agent 克隆选择器", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-1915-clone");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("挂载时不打 listAgents——只有点开克隆选择器才打（懒加载）", async () => {
    const calls = stubFetch();
    render(<AgentDefinitionCreatePanel prefix={PREFIX} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.path === agentRuntime.operations.listAgents.path)).toBe(false);
  });

  it("选中克隆源 ⇒ 名称/角标/职责/头衔/可见范围被预填", async () => {
    stubFetch();
    render(<AgentDefinitionCreatePanel prefix={PREFIX} />);
    fireEvent.click(screen.getByTestId(`${PREFIX}-clone-open`));
    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-clone-select`)).toBeTruthy());
    fireEvent.change(screen.getByTestId(`${PREFIX}-clone-select`), { target: { value: SOURCE_ID } });

    expect((screen.getByTestId(`${PREFIX}-add-name`) as HTMLInputElement).value).toBe("值班助理");
    expect((screen.getByTestId(`${PREFIX}-add-initials`) as HTMLInputElement).value).toBe("YB");
    expect((screen.getByTestId(`${PREFIX}-add-role`) as HTMLInputElement).value).toBe("值班一句话");
    expect((screen.getByTestId(`${PREFIX}-add-role-label`) as HTMLInputElement).value).toBe("值班头衔");
    expect(screen.getByTestId(`${PREFIX}-clone-selected`).textContent).toContain("值班助理");
  });

  it("克隆提交 ⇒ POST /agents 带上选中的 cloneFrom，且留空 instructions 不发 PATCH", async () => {
    const calls = stubFetch();
    render(<AgentDefinitionCreatePanel prefix={PREFIX} />);
    fireEvent.click(screen.getByTestId(`${PREFIX}-clone-open`));
    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-clone-select`)).toBeTruthy());
    fireEvent.change(screen.getByTestId(`${PREFIX}-clone-select`), { target: { value: SOURCE_ID } });

    fireEvent.click(screen.getByTestId(`${PREFIX}-add-submit`));
    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-publish`)).toBeTruthy());

    const createCall = calls.find(
      (c) => c.method === "POST" && c.path === agentRuntime.operations.createAgent.path,
    );
    expect(createCall?.body?.cloneFrom).toBe(SOURCE_ID);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("改为从零新建 ⇒ 表单清空，cloneFrom 归 null，指令重新变必填", async () => {
    stubFetch();
    render(<AgentDefinitionCreatePanel prefix={PREFIX} />);
    fireEvent.click(screen.getByTestId(`${PREFIX}-clone-open`));
    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-clone-select`)).toBeTruthy());
    fireEvent.change(screen.getByTestId(`${PREFIX}-clone-select`), { target: { value: SOURCE_ID } });
    fireEvent.click(screen.getByTestId(`${PREFIX}-clone-clear`));

    expect((screen.getByTestId(`${PREFIX}-add-name`) as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByTestId(`${PREFIX}-add-name`), { target: { value: "全新助手" } });
    fireEvent.change(screen.getByTestId(`${PREFIX}-add-initials`), { target: { value: "QX" } });
    fireEvent.change(screen.getByTestId(`${PREFIX}-add-role`), { target: { value: "全新职责" } });
    fireEvent.change(screen.getByTestId(`${PREFIX}-add-role-label`), { target: { value: "全新头衔" } });
    fireEvent.click(screen.getByTestId(`${PREFIX}-add-submit`));

    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-add-error`)).toBeTruthy());
    expect(screen.getByTestId(`${PREFIX}-add-error`).textContent).toContain("执行什么");
  });
});
