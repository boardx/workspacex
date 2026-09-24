/**
 * 对标 R8（#3933）—— 钉在元素上的批注。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/d", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import * as React from "react";
import { composeCommentsMessage, loadComments, useDesignComments, type DesignComment } from "@/lib/design-comments";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
import type { DesignProject } from "@/lib/live-design-workbench";

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); apiRequest.mockReset(); });

const c = (over: Partial<DesignComment>): DesignComment => ({ id: "c1", nodeId: "buy", frameIndex: 0, label: "按钮「立即购买」", text: "再醒目一点", resolved: false, ...over });

describe("合成交给 AI 的那一条消息", () => {
  it("每条带页、元素名与节点 id（模型据 id 局部改，不整页重画）", () => {
    const msg = composeCommentsMessage([c({}), c({ id: "c2", nodeId: "tabs", frameIndex: 1, label: "标签页（详情/评价）", text: "评价放第一个" })], ["商品详情", "确认订单"]);
    expect(msg.split("\n")[0]).toContain("2 条批注");
    expect(msg).toContain("1. 第 1 页「商品详情」的按钮「立即购买」（节点 id: buy）：再醒目一点");
    expect(msg).toContain("2. 第 2 页「确认订单」的标签页（详情/评价）（节点 id: tabs）：评价放第一个");
    expect(msg).toContain("不要整页重画");
  });
});

describe("存储", () => {
  it("按项目存在浏览器里，刷新读得回来；坏数据读成空而不是崩", () => {
    const { result } = renderHook(() => useDesignComments("p1"));
    act(() => result.current.add({ nodeId: "buy", frameIndex: 0, label: "按钮", text: "再醒目一点" }));
    expect(loadComments("p1")).toHaveLength(1);
    expect(loadComments("p2")).toHaveLength(0);
    window.localStorage.setItem("wsx-design-comments:p3", "{not json");
    expect(loadComments("p3")).toEqual([]);
  });

  it("交给 AI 之后标为已处理；清掉已交的", () => {
    const { result } = renderHook(() => useDesignComments("p1"));
    act(() => result.current.add({ nodeId: "a", frameIndex: 0, label: "A", text: "x" }));
    act(() => result.current.add({ nodeId: "b", frameIndex: 0, label: "B", text: "y" }));
    act(() => result.current.resolve([result.current.comments[0]!.id]));
    expect(result.current.comments.map((x) => x.resolved)).toEqual([true, false]);
    act(() => result.current.clearResolved());
    expect(result.current.comments.map((x) => x.nodeId)).toEqual(["b"]);
  });

  it("存储抛错（隐私模式 / 配额满）⇒ 照样在内存里工作，不打断", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    const { result } = renderHook(() => useDesignComments("p1"));
    act(() => result.current.add({ nodeId: "a", frameIndex: 0, label: "A", text: "x" }));
    expect(result.current.comments).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("批注模式（详情页）", () => {
  const project: DesignProject = {
    id: "p1", name: "下单", template: "mobile", theme: "light", accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" },
    tags: [], refImages: [], share: null, problem: "", criteria: [], frames: ["商品详情"], frameNotes: [],
    prototype: [{ type: "stack", id: "root", children: [{ type: "button", id: "buy", props: { label: "立即购买" } }, { type: "text", id: "t", props: { content: "年度会员" } }] }] as never,
    pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
    chat: [], ownerId: "u", ownerName: "我", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
  };

  it("点元素 ⇒ 写一句 ⇒ 列表里有它；交给 AI 是一次对话、不带单节点焦点；发成功才标已处理", async () => {
    const chats: { text: string; focusNodeId?: string }[] = [];
    let fail = true;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: { text: string; focusNodeId?: string } }) => {
      if (path === "/pm-designs") return { items: [project] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        chats.push(opts.body!);
        if (fail) throw new TypeError("Failed to fetch");
        return { project, reply: { source: "model", applied: [], suggestions: [] } };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-view-single"));
    fireEvent.click(screen.getByTestId("design-detail-mode-comment"));
    fireEvent.click(screen.getByText("立即购买"));
    // 批注模式下选中不出属性面板（点节点 = 给它写一句，不是去改它）。
    expect(screen.queryByTestId("design-inspector")).toBeNull();
    fireEvent.change(screen.getByTestId("design-comment-input"), { target: { value: "按钮再醒目一点" } });
    fireEvent.click(screen.getByTestId("design-comment-save"));
    expect(screen.getAllByTestId("design-comment-item")).toHaveLength(1);
    expect(screen.getByTestId("design-comments").textContent).toContain("按钮「立即购买」");

    // 第一次发失败 ⇒ 仍是待改（⭐ 反证锚点：不看发送结果就标已处理 ⇒ 这里就会被标掉，批注悄悄丢了）。
    fireEvent.click(screen.getByTestId("design-comments-send"));
    await waitFor(() => expect(chats).toHaveLength(1));
    await screen.findByTestId("design-detail-chat-error");
    expect(screen.getByTestId("design-comment-item").getAttribute("data-resolved")).toBeNull();
    expect(chats[0]!.focusNodeId).toBeUndefined();
    expect(chats[0]!.text).toContain("（节点 id: buy）：按钮再醒目一点");

    fail = false;
    fireEvent.click(screen.getByTestId("design-comments-send"));
    await waitFor(() => expect(screen.getByTestId("design-comment-item").getAttribute("data-resolved")).toBe("true"));
  });
});
