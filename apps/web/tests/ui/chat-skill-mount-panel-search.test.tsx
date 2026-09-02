import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * 2026-09-02 候选浮层重设计（人类反馈「skill 多的时候要怎么显示、要能过滤和搜索、
 * 当前选中的也要显示」）：
 * ① 搜索框按名称 / duty 过滤；② 已挂载的 skill 在浮层里带勾置顶，点一下即卸载；
 * ③ 未挂载的点一下即挂载（既有锚点 `chat-skill-mount-option-<id>` 不变）。
 */

const { listThreadMounts, mountSkills, unmountSkill, listSkills } = vi.hoisted(() => ({
  listThreadMounts: vi.fn(),
  mountSkills: vi.fn(),
  unmountSkill: vi.fn(),
  listSkills: vi.fn(),
}));

vi.mock("@/lib/live-skill-mount", () => ({
  listThreadMounts: (...a: unknown[]) => listThreadMounts(...a),
  mountSkills: (...a: unknown[]) => mountSkills(...a),
  unmountSkill: (...a: unknown[]) => unmountSkill(...a),
}));
vi.mock("@/lib/live-skill", () => ({ listSkills: (...a: unknown[]) => listSkills(...a) }));
vi.mock("@/components/chat/chat-live-message-panel", () => ({
  ChatLiveMessagePanel: () => <div data-testid="stub-message-panel" />,
  describeMessageFailure: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock("@/components/feedback/feedback-button", () => ({
  FeedbackButton: () => <button data-testid="stub-feedback-button" />,
}));

import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";

const SKILL_POOL = [
  { skillId: "sk_aaa", name: "pptx", status: "已启用" as const, duty: "生成演示文稿" },
  { skillId: "sk_bbb", name: "Excel 表格生成", status: "已启用" as const, duty: "导入 / 导出表格" },
  { skillId: "sk_ccc", name: "web-design-engineer", status: "已启用" as const, duty: "网页设计" },
];

beforeEach(() => {
  listThreadMounts.mockReset().mockResolvedValue({
    temporary: [{ mountId: "m1", threadId: "thr-1", skillId: "sk_bbb", versionId: "v1", mountedAt: "2026-09-02T00:00:00.000Z" }],
    version: "1",
  });
  mountSkills.mockReset().mockResolvedValue(undefined);
  unmountSkill.mockReset().mockResolvedValue(undefined);
  listSkills.mockReset().mockResolvedValue(SKILL_POOL);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function openComposerPicker() {
  const { rerender } = render(
    <ChatSkillMountPanel variant="composer" threadId="thr-1" orgId="org-1" bearer="b" mentionTriggerChar="/" openRequest={0} />,
  );
  await screen.findByTestId("chat-skill-mounted-sk_bbb");
  rerender(
    <ChatSkillMountPanel variant="composer" threadId="thr-1" orgId="org-1" bearer="b" mentionTriggerChar="/" openRequest={1} />,
  );
  await screen.findByTestId("chat-skill-mount-picker");
}

describe("ChatSkillMountPanel 候选浮层 —— 搜索 / 已挂载分组", () => {
  it("已挂载的 skill 带勾置顶显示，其余在「可挂载」分组；计数行如实写出数量", async () => {
    await openComposerPicker();
    const mounted = screen.getByTestId("chat-skill-mount-picker-mounted");
    expect(mounted).toHaveTextContent("Excel 表格生成");
    expect(screen.getByTestId("chat-skill-mount-option-sk_bbb")).toHaveAttribute("data-mounted", "true");
    expect(screen.getByTestId("chat-skill-mount-option-sk_aaa")).toHaveAttribute("data-mounted", "false");
    expect(screen.getByTestId("chat-skill-mount-picker-count")).toHaveTextContent("已挂 1 个 · 共 3 个可用");
  });

  it("搜索框按名称 / duty 不区分大小写过滤；搜不到给专门的空态", async () => {
    await openComposerPicker();
    const search = screen.getByTestId("chat-skill-mount-search");
    fireEvent.change(search, { target: { value: "WEB" } });
    expect(screen.getByTestId("chat-skill-mount-option-sk_ccc")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-skill-mount-option-sk_aaa")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-skill-mount-option-sk_bbb")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "演示" } });
    expect(screen.getByTestId("chat-skill-mount-option-sk_aaa")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "不存在的" } });
    expect(screen.getByTestId("chat-skill-mount-mention-no-match")).toHaveTextContent("不存在的");
  });

  it("点已挂载项 ⇒ 卸载；点未挂载项 ⇒ 挂载；Enter 挂第一个匹配项", async () => {
    await openComposerPicker();
    fireEvent.click(screen.getByTestId("chat-skill-mount-option-sk_bbb"));
    await waitFor(() => expect(unmountSkill).toHaveBeenCalledWith("thr-1", "m1", undefined, "b"));

    fireEvent.click(screen.getByTestId("chat-skill-mount-option-sk_ccc"));
    await waitFor(() => expect(mountSkills).toHaveBeenCalledWith("thr-1", undefined, { skillIds: ["sk_ccc"], expectedVersion: "1" }, "b"));
  });

  it("Enter 在搜索框里挂载第一个可挂载的匹配项", async () => {
    await openComposerPicker();
    const search = screen.getByTestId("chat-skill-mount-search");
    fireEvent.change(search, { target: { value: "pptx" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(mountSkills).toHaveBeenCalledWith("thr-1", undefined, { skillIds: ["sk_aaa"], expectedVersion: "1" }, "b"));
  });
});
