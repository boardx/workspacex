/**
 * #1911 —— `AgentCapabilityGraph`（Agent 详情页「能力图」只读视图）。
 *
 * 真实 React Flow 在 jsdom 下无法渲染（`ResizeObserver` 等浏览器 API 缺失），本文件用
 * `tests/support/xyflow-stub.tsx` 替身掉「怎么把节点摆上画布」，只测「我们喂给
 * React Flow 的东西对不对」——数据组装（`buildAgentCapabilityGraphModel`）与自定义
 * 节点组件（`CapabilityNode`，含跳转 href）都是真代码、真渲染，不是 mock。
 *
 * 覆盖：
 * · 真实渲染出节点数 = skill 数 + mcp 数 + 1（agent 自身），边数 = skill 数 + mcp 数。
 * · Skill 节点可点击跳转到 `/admin/skill/<id>`；MCP 节点可点击跳转到 MCP 管理页。
 * · 空态：没有挂载任何能力时明确提示，不画孤零零一个节点（反空转：断言画布压根
 *   没有渲染，不是「画了但看不出差别」）。
 * · 读取失败态：不静默吞错误。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import { AgentCapabilityGraph } from "@/components/admin/agent-capability-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const AGENT_ID = "agent-cap-1";
const ORG_ID = "org-cap-1";

afterEach(() => cleanup());

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-cap-graph");
});

function stubFetch(agentBody: unknown, skillBody: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(`/agents/${AGENT_ID}`)) return jsonResponse(agentBody);
      if (url.includes("/capabilities")) return jsonResponse(skillBody);
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("AgentCapabilityGraph", () => {
  it("挂了 skill 与 mcp 工具时，画出节点与边，且能点击跳转", async () => {
    stubFetch(
      {
        agentId: AGENT_ID,
        name: "客服助理",
        roleLabel: "客服",
        skillMounts: [{ skillId: "skill-ppt", skillVersion: 2 }],
        toolWhitelist: [
          { toolFullName: "mcp:crm-server.submit_inquiry", state: "在授权范围内", elevationDecision: null },
        ],
      },
      [{ id: "skill-ppt", orgId: ORG_ID, kind: "skill", name: "PPT 生成", scope: "org-wide", enabled: true, endpoint: null, disabledReason: null }],
    );

    render(<AgentCapabilityGraph orgId={ORG_ID} agentId={AGENT_ID} />);

    // next/dynamic({ssr:false}) 懒加载 + 两个并发 fetch，负载重的机器上默认 1s 的
    // waitFor 超时不够用（同 asset-code-editor-monaco.test.tsx 对 Monaco 懒加载的
    // 处理）——显式放宽，不是掩盖真实慢，是给懒加载真实需要的时间。
    await waitFor(() => expect(screen.getByTestId("xyflow-stub-canvas")).toBeInTheDocument(), {
      timeout: 10_000,
    });

    // 1 个 agent 节点 + 1 个 skill 节点 + 1 个 mcp 节点
    expect(screen.getByTestId("xyflow-stub-node-count")).toHaveTextContent("3");
    // 2 条边：agent→skill、agent→mcp
    expect(screen.getByTestId("xyflow-stub-edge-count")).toHaveTextContent("2");

    const skillLink = screen.getByTestId("agent-capability-graph-node-skill-skill-ppt-link");
    expect(skillLink).toHaveAttribute("href", "/admin/skill/skill-ppt");
    expect(skillLink).toHaveTextContent("PPT 生成");

    const mcpLink = screen.getByTestId(
      "agent-capability-graph-node-mcp-crm-server-submit_inquiry-link",
    );
    expect(mcpLink).toHaveAttribute("href", "/preview/agent-runtime?screen=mcp-policy");
    expect(mcpLink).toHaveTextContent("crm-server.submit_inquiry");
  });

  it("空态：没有挂载任何能力时给出明确提示，不渲染画布", async () => {
    stubFetch({
      agentId: AGENT_ID,
      name: "空白 Agent",
      roleLabel: "待配置",
      skillMounts: [],
      toolWhitelist: [],
    });

    render(<AgentCapabilityGraph orgId={ORG_ID} agentId={AGENT_ID} />);

    await waitFor(
      () => expect(screen.getByTestId("agent-capability-graph-empty")).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.getByTestId("agent-capability-graph-empty")).toHaveTextContent(
      "还没有挂载任何能力",
    );
    expect(screen.queryByTestId("xyflow-stub-canvas")).not.toBeInTheDocument();
  });

  it("读取失败时明确报错，不静默留空", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ reasonCode: "AGENT_NOT_FOUND" }, 404)),
    );

    render(<AgentCapabilityGraph orgId={ORG_ID} agentId={AGENT_ID} />);

    await waitFor(
      () => expect(screen.getByTestId("agent-capability-graph-error")).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.getByTestId("agent-capability-graph-error")).toHaveTextContent("AGENT_NOT_FOUND");
  });
});
