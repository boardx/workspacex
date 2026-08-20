/**
 * #1681 —— `workflow-screen.tsx` 从整屏 mock 切到真实 `getWorkflowOrchestration` 的组件测试。
 *
 * 与 `blueprint-list-screen-live.test.tsx`（BP-05）同一模式：假 `fetch`，不连真实后端。
 * 钉住：
 *   ① 真实数据渲染——模板层 + 环节链 + 编排矩阵都来自契约字段，不是 mock。
 *   ② `projectId` 缺失时就地报错（testid `err-projectId`），不静默用假数据兜底、不崩溃。
 *   ③ 空态/错误态：`NO_PROJECT_ROLE` → 无权限态；`DEPENDENCY_UNAVAILABLE` → 依赖失败态
 *     （可重试）；未合并 #1680 时的 404（无 reasonCode）也走依赖失败态，不是白屏崩溃。
 *   ④ 7c 模板库如实降级——不渲染任何编造的模板卡片。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { WorkflowScreen } from "@/components/tpl/workflow-screen";

const PROJECT_ID = "proj-e2e-1681";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REAL_ORCHESTRATION = {
  template: { templateId: "wt-1", name: "真实工作流模板", sourceVersion: 3 },
  segmentChain: [
    { agendaSegmentId: "seg-1", title: "对齐目标", addedBy: null, optional: false },
    { agendaSegmentId: "seg-2", title: "破冰", addedBy: "format-setting", optional: true },
  ],
  matrix: [
    {
      cellId: "cell-1", agendaSegmentId: "seg-1", roleKey: "facilitator",
      content: "播报目标", canvasTemplateId: "canvas-hmw", skillIds: ["skill-1", "skill-2"],
    },
    {
      cellId: "cell-2", agendaSegmentId: "seg-1", roleKey: "groupLead",
      content: "记录疑问", canvasTemplateId: null, skillIds: [],
    },
  ],
};

function noop() {}

describe("#1681 /tpl workflow-screen：真实 getWorkflowOrchestration", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-1681");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("真实数据渲染：模板层 + 环节链 + 编排矩阵都来自契约字段，不是 mock", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === `/projects/${PROJECT_ID}/orchestration`) {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer tok-e2e-1681");
        return jsonResponse(REAL_ORCHESTRATION);
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkflowScreen projectId={PROJECT_ID} uiState="default" previewRole="facilitator" onToast={noop} />,
    );

    expect(await screen.findByText("真实工作流模板")).toBeTruthy();
    expect(screen.getByTestId("tpl-wf-source")).toHaveTextContent("v3");
    expect(screen.getByTestId("tpl-segment-chain")).toHaveTextContent("对齐目标");
    expect(screen.getByTestId("tpl-segment-chain")).toHaveTextContent("破冰");

    const cell = screen.getAllByTestId("tpl-matrix-cell")[0];
    expect(cell).toHaveTextContent("播报目标");

    // 反证：不得出现旧 mock 专属的字符串（原 mock/tpl.ts 的模板名与环节名）
    expect(document.body.textContent ?? "").not.toMatch(/设计思维标准五步|假设风暴 · hmw/);
  });

  it("projectId 缺失：就地报错（err-projectId），不发请求、不用假数据兜底", async () => {
    fetchMock = vi.fn(async () => {
      throw new Error("不应该发起任何真实请求");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkflowScreen projectId={null} uiState="default" previewRole="facilitator" onToast={noop} />);

    expect(await screen.findByTestId("err-projectId")).toHaveTextContent("缺少 projectId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("NO_PROJECT_ROLE：走无权限态，说明是项目层限制", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ reasonCode: "NO_PROJECT_ROLE" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkflowScreen projectId={PROJECT_ID} uiState="default" previewRole="facilitator" onToast={noop} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("denied")).toBeTruthy();
    });
    expect(screen.getByTestId("denied-layer")).toHaveTextContent("项目层限制");
  });

  it("DEPENDENCY_UNAVAILABLE：走依赖失败态，可重试", async () => {
    let calls = 0;
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls += 1;
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === `/projects/${PROJECT_ID}/orchestration`) {
        if (calls === 1) return jsonResponse({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503);
        return jsonResponse(REAL_ORCHESTRATION);
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkflowScreen projectId={PROJECT_ID} uiState="default" previewRole="facilitator" onToast={noop} />,
    );

    await waitFor(() => expect(screen.getByTestId("dep-failed")).toBeTruthy());

    fireEvent.click(screen.getByTestId("dep-failed-retry"));

    await waitFor(() => expect(screen.getByText("真实工作流模板")).toBeTruthy());
    expect(calls).toBe(2);
  });

  it("#1680 未合并时的 404（无 reasonCode）：走依赖失败态，不是白屏崩溃", async () => {
    fetchMock = vi.fn(async () => new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkflowScreen projectId={PROJECT_ID} uiState="default" previewRole="facilitator" onToast={noop} />,
    );

    await waitFor(() => expect(screen.getByTestId("dep-failed")).toBeTruthy());
  });

  it("7c 模板库：如实降级说明契约缺口，不渲染任何编造的模板卡片", async () => {
    fetchMock = vi.fn(async () => jsonResponse(REAL_ORCHESTRATION));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkflowScreen projectId={PROJECT_ID} uiState="default" previewRole="facilitator" onToast={noop} />,
    );

    await screen.findByText("真实工作流模板");

    expect(screen.queryByTestId("tpl-library-row")).toBeNull();
    expect(screen.getByTestId("tpl-library-gap")).toBeTruthy();
    expect(screen.getByTestId("tpl-library-blank")).toBeDisabled();
  });
});
