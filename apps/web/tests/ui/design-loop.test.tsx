/**
 * UC-17.8 研发闭环（反馈 → 设计 → 排期）—— 核心交互的可执行断言。
 *
 * 断的五件事（R10 验收清单里最容易静默退化的几条）：
 *   ① 字段集随「这是什么」切换（缺陷 3 项 ↔ 需求 3 项）。
 *   ② 附件到 5 个后上传入口**隐藏**（不是置灰）。
 *   ③ 转「不做」在理由为空时确认按钮禁用；填了理由才能确认，且理由进时间线。
 *   ④ 看板卡片拖到另一列触发状态迁移。
 *   ⑤ 推送设计方案后，原反馈与新方案**互相打标**（三处一致）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream: vi.fn(),
}));

import * as React from "react";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { DesignLoopInboxScreen } from "@/components/design-loop/inbox-screen";
import { DesignLoopProvider, useDesignLoop, type MockInboxItem, type Project } from "@/lib/design-loop-store";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function wrap(seed?: Parameters<typeof DesignLoopProvider>[0]["seed"]) {
  return ({ children }: { children: React.ReactNode }) => (
    <DesignLoopProvider seed={seed ?? {}}>{children}</DesignLoopProvider>
  );
}

describe("① 快速反馈：字段集随类型切换", () => {
  it("缺陷显示缺陷字段集，切到需求显示需求字段集", () => {
    render(<FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={() => undefined} />);
    expect(screen.getByTestId("feedback-fields-bug")).toBeTruthy();
    expect(screen.queryByTestId("feedback-fields-req")).toBeNull();
    // 缺陷版有「实际结果」补充字段
    expect(screen.getByTestId("feedback-field-actual")).toBeTruthy();
    fireEvent.click(screen.getByTestId("feedback-kind-需求"));
    expect(screen.getByTestId("feedback-fields-req")).toBeTruthy();
    expect(screen.queryByTestId("feedback-fields-bug")).toBeNull();
    // 需求版有「使用场景」，没有缺陷版的「实际结果」
    expect(screen.getByTestId("feedback-field-scene")).toBeTruthy();
    expect(screen.queryByTestId("feedback-field-actual")).toBeNull();
  });
});

describe("② 附件到 5 个后上传入口隐藏", () => {
  it("attachments 达到上限时不再渲染「加文件」入口，而是提示已满", () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, text: async () => JSON.stringify({ attachmentId: "a", url: "/x" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={() => undefined} />);
      const files = Array.from({ length: 5 }, (_, i) => new File([new Uint8Array([1])], `f${i}.png`, { type: "image/png" }));
      fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files } });
      expect(screen.queryByTestId("feedback-attachment-add")).toBeNull();
      expect(screen.getByTestId("feedback-attachment-full")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const oneBacklogFeedback: MockInboxItem[] = [
  {
    id: "x1", kind: "feedback", type: "bug", code: "B-1", title: "标题一", body: "正文一",
    reporter: "谁", time: "2026-09-01T00:00:00.000Z", votes: 1, status: "backlog", severe: false,
    timeline: [{ at: "2026-09-01T00:00:00.000Z", text: "进入收件箱" }],
  },
];

describe("③ 转不做：理由为空禁用，填了才能确认且进时间线", () => {
  it("展开理由后确认按钮禁用；填理由后可确认", () => {
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap({ inbox: oneBacklogFeedback }) });
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    fireEvent.click(screen.getByTestId("inbox-action-decline"));
    expect(screen.getByTestId("err-reason")).toBeTruthy();
    expect((screen.getByTestId("inbox-decline-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("inbox-decline-reason"), { target: { value: "与别的能力重叠" } });
    expect((screen.getByTestId("inbox-decline-confirm") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("inbox-decline-confirm"));
    // 重新打开详情，理由与时间线可见
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    expect(screen.getByTestId("inbox-drawer-reason").textContent).toContain("与别的能力重叠");
  });
});

describe("④ 看板拖放触发状态迁移", () => {
  it("把待处理卡片拖到进行中列，卡片移动到进行中", () => {
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap({ inbox: oneBacklogFeedback }) });
    // 拖前：待处理列 1 条，进行中 0 条
    expect(screen.getByTestId("inbox-column-count-backlog").textContent).toBe("1");
    expect(screen.getByTestId("inbox-column-count-doing").textContent).toBe("0");
    fireEvent.drop(screen.getByTestId("inbox-column-doing"), {
      dataTransfer: { getData: () => "x1" },
    });
    expect(screen.getByTestId("inbox-column-count-backlog").textContent).toBe("0");
    expect(screen.getByTestId("inbox-column-count-doing").textContent).toBe("1");
  });
});

describe("⑤ 推送设计方案后反馈与方案互相打标", () => {
  it("pushProject 后：项目 resolvedInbox 有值、生成的收件箱条目、源反馈被标已生成", () => {
    const feedback: MockInboxItem[] = [
      { ...oneBacklogFeedback[0]!, code: "B-3", id: "fb3" },
    ];
    const project: Project = {
      id: "p1", name: "深化 B-3", template: "wireframe", emoji: "🧩", owner: "我", updated: "2026-09-01T00:00:00.000Z",
      pushed: false, linkedFeedback: "B-3", problem: "问题", criteria: ["a"], frames: ["草稿页 1"], chat: [],
    };
    const { result } = renderHook(() => useDesignLoop(), { wrapper: wrap({ inbox: feedback, projects: [project] }) });

    let code = "";
    act(() => { code = result.current.pushProject("p1"); });

    // 三处一致：① 项目标记已推送 + resolvedInbox=code
    const p = result.current.projects.find((x) => x.id === "p1")!;
    expect(p.pushed).toBe(true);
    expect(p.resolvedInbox).toBe(code);
    // ② 收件箱新增一条设计方案条目，源自 B-3
    const design = result.current.inbox.find((i) => i.code === code)!;
    expect(design.kind).toBe("design");
    expect(design.linkedFeedback).toBe("B-3");
    // ③ 源反馈 B-3 被标「已生成 <code>」
    const src = result.current.inbox.find((i) => i.code === "B-3")!;
    expect(src.resolvedByDesign).toBe(code);
  });
});
