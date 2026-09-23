/**
 * TW-P1-4 的四颗验收锚点 —— **锚点必须证明能力，而不是证明标题存在。**
 *
 * ## 这轮发现了什么（2026-09-23）
 *
 * `.harness/instructions/chat-task-workbench-acceptance.md` 的 TW-P1-4 要求产物
 * 「预览 / 来源 / 版本 / 导出」四件齐，锚点是
 * `chat-task-workbench-artifact-{preview|sources|versions|export}`。四颗里有三颗
 * 挂在**标题文字或包裹容器**上：
 *   · `-preview` → `<h2>产物预览（N）</h2>`
 *   · `-versions` → `<h3>成果与版本</h3>`
 *   · `-sources` → 列表的包裹 `<div>`
 * 只有 `-export` 挂在真的会下载的按钮上。
 *
 * 也就是说：#2099 之前点产物条目**根本没反应**，而那段时间 TW-P1-4 的「预览」一直绿。
 * 这是本仓反复出现的形状——[[fixture-cannot-exhibit-the-defect]]：判据在那个位置上
 * 无法被证伪。
 *
 * ## 这份测试的作用
 *
 * 真栈跑一次十四分钟，所以先在 jsdom 里把 e2e 依赖的**前提**钉住：锚点唯一、
 * 且只在能力真的出现之后才出现。e2e 那边只负责在真实数据上再验一遍。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import type { ListThreadArtifactsOut } from "@/lib/live-chat";

vi.mock("@/components/chat/workbench/agent-artifact-versions-panel", () => ({
  AgentArtifactVersionsPanel: () => null,
}));
vi.mock("@/lib/live-chat", async (orig) => ({
  ...(await orig<object>()),
  getThreadArtifactSource: vi.fn().mockResolvedValue({
    markdown: "# 结果\n\n正文", version: 2, savedAt: "2026-09-23T00:00:00.000Z", savedBy: "u1",
  }),
}));

const artifacts = {
  items: [
    { artifactId: "a-1", title: "调研报告", mode: "draft", hasSource: true, version: 1 },
    { artifactId: "a-2", title: "财务测算", mode: "draft", hasSource: false, version: 1 },
  ],
} as unknown as ListThreadArtifactsOut;

function props(): ChatTaskInspectorProps {
  return {
    hasSelection: true, threadId: "t-1", artifacts, materials: null, loading: false,
    artifactsError: null, materialsError: null, onRetry: () => {}, pendingMaterialsCount: 0,
    planTodos: null, isRunning: false, runPhaseLabel: null, runStartedAt: null,
    onOpenArtifact: vi.fn(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function openArtifactsTab(): void {
  fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-expand"));
  fireEvent.click(screen.getByRole("tab", { name: /产物/ }));
}

describe("TW-P1-4 锚点", () => {
  it("没打开任何产物时，「预览」锚点不存在——它不再由标题文字满足", () => {
    render(<ChatTaskInspector {...props()} />);
    openArtifactsTab();
    // 标题「产物预览」仍然在，但它不再是验收锚点。
    expect(screen.getByTestId("chat-artifacts-panel-title")).toBeVisible();
    expect(screen.queryByTestId("chat-task-workbench-artifact-preview")).toBeNull();
  });

  it("打开一份产物后，「预览」锚点出现，且渲染的是真正文", async () => {
    render(<ChatTaskInspector {...props()} />);
    openArtifactsTab();
    fireEvent.click(screen.getByText("调研报告"));
    const preview = await screen.findByTestId("chat-task-workbench-artifact-preview");
    expect(preview).toHaveTextContent("正文");
  });

  /*
   * e2e 的 `expectAnchor` 用的是 Playwright `getByTestId`，它是 strict 的：
   * 同名锚点出现两次当场 violation（并行会话今天刚因为「组织名出现两次」红过）。
   * 列表里有两条产物，所以这条专门钉唯一性。
   */
  it("锚点唯一——列表里有多份产物时也只出现一次", async () => {
    render(<ChatTaskInspector {...props()} />);
    openArtifactsTab();
    expect(screen.getAllByTestId("chat-task-workbench-artifact-sources")).toHaveLength(1);
    fireEvent.click(screen.getByText("调研报告"));
    await screen.findByTestId("chat-task-workbench-artifact-preview");
    expect(screen.getAllByTestId("chat-task-workbench-artifact-preview")).toHaveLength(1);
  });

  /*
   * 这一条是写 e2e 时**差点写错**的那件事：四颗锚点不可能同时在场。
   * 打开一份产物会把列表整段换成详情态，列表/版本/导出随之卸载。
   * e2e 因此必须按两态分别验——把这个前提钉在这里，而不是等真栈跑十四分钟告诉我。
   */
  it("详情态会把列表换掉：四颗锚点不可能同时在场", async () => {
    render(<ChatTaskInspector {...props()} />);
    openArtifactsTab();
    expect(screen.getByTestId("chat-task-workbench-artifact-sources")).toBeVisible();
    fireEvent.click(screen.getByText("调研报告"));
    await screen.findByTestId("chat-task-workbench-artifact-preview");
    expect(screen.queryByTestId("chat-task-workbench-artifact-sources")).toBeNull();
  });
});
