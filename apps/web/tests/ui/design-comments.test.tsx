/**
 * 对标 R8（#3933）—— 钉在元素上的批注。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/d", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import * as React from "react";
import { composeCommentsMessage, loadLegacyComments, useDesignComments, type DesignComment } from "@/lib/design-comments";
import { CommentList } from "@/components/design-loop/comments-panel";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
import type { DesignProject } from "@/lib/live-design-workbench";

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); apiRequest.mockReset(); });

const c = (over: Partial<DesignComment>): DesignComment => ({
  id: "c1", nodeId: "buy", frameIndex: 0, label: "按钮「立即购买」", text: "再醒目一点", resolved: false,
  authorId: "u", authorName: "我", createdAt: "2026-09-24T00:00:00.000Z", replies: [], ...over,
});

/** 深度 S2：批注的「服务端」——一份内存表，按 REST 语义回话。 */
function commentServer() {
  const rows: DesignComment[] = [];
  let n = 0;
  const handle = (path: string, opts?: { method?: string; body?: Record<string, unknown> }): unknown => {
    const m = /^\/pm-designs\/([^/]+)\/comments(?:\/([^/]+))?$/.exec(path);
    if (m === null) return undefined;
    const method = opts?.method ?? "GET";
    if (m[2] === undefined && method === "GET") return { items: rows.filter((r) => r.id.startsWith(`${m[1]}:`)) };
    if (m[2] === undefined && method === "POST") {
      const row = c({ ...(opts!.body as Partial<DesignComment>), id: `${m[1]}:c${++n}` });
      rows.push(row);
      return { comment: row };
    }
    const i = rows.findIndex((r) => r.id === decodeURIComponent(m[2]!));
    if (i < 0) throw new Error("COMMENT_NOT_FOUND");
    if (method === "DELETE") { rows.splice(i, 1); return {}; }
    rows[i] = { ...rows[i]!, resolved: Boolean(opts!.body!.resolved) };
    return { comment: rows[i] };
  };
  return { rows, handle };
}

describe("合成交给 AI 的那一条消息", () => {
  it("每条带页、元素名与节点 id（模型据 id 局部改，不整页重画）", () => {
    const msg = composeCommentsMessage([c({}), c({ id: "c2", nodeId: "tabs", frameIndex: 1, label: "标签页（详情/评价）", text: "评价放第一个" })], ["商品详情", "确认订单"]);
    expect(msg.split("\n")[0]).toContain("2 条批注");
    expect(msg).toContain("1. 第 1 页「商品详情」的按钮「立即购买」（节点 id: buy）：再醒目一点");
    expect(msg).toContain("2. 第 2 页「确认订单」的标签页（详情/评价）（节点 id: tabs）：评价放第一个");
    expect(msg).toContain("不要整页重画");
  });
});

describe("存储（深度 S2：服务端）", () => {
  it("写一条 ⇒ 交给服务端；重新打开这个项目（新的 hook）读得回来；别的项目看不到", async () => {
    const server = commentServer();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => server.handle(path, opts));
    const { result } = renderHook(() => useDesignComments("p1"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/pm-designs/p1/comments"));
    await act(async () => { await result.current.add({ nodeId: "buy", frameIndex: 0, label: "按钮", text: "再醒目一点" }); });
    expect(server.rows).toHaveLength(1);
    const again = renderHook(() => useDesignComments("p1"));
    await waitFor(() => expect(again.result.current.comments.map((x) => x.text)).toEqual(["再醒目一点"]));
    const other = renderHook(() => useDesignComments("p2"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/pm-designs/p2/comments"));
    expect(other.result.current.comments).toEqual([]);
  });

  it("交给 AI 之后标为已解决（服务端那份也变）；清掉已解决的", async () => {
    const server = commentServer();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => server.handle(path, opts));
    const { result } = renderHook(() => useDesignComments("p1"));
    await act(async () => { await result.current.add({ nodeId: "a", frameIndex: 0, label: "A", text: "x" }); });
    await act(async () => { await result.current.add({ nodeId: "b", frameIndex: 0, label: "B", text: "y" }); });
    await act(async () => { await result.current.resolve([result.current.comments[0]!.id]); });
    expect(result.current.comments.map((x) => x.resolved)).toEqual([true, false]);
    expect(server.rows.map((x) => x.resolved)).toEqual([true, false]);
    await act(async () => { await result.current.clearResolved(); });
    expect(result.current.comments.map((x) => x.nodeId)).toEqual(["b"]);
    expect(server.rows.map((x) => x.nodeId)).toEqual(["b"]);
  });

  it("服务端写失败 ⇒ 屏上不变、说出来（不装作存上了）", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") throw new TypeError("Failed to fetch");
      return path.endsWith("/comments") ? { items: [] } : undefined;
    });
    const { result } = renderHook(() => useDesignComments("p1"));
    await act(async () => { expect(await result.current.add({ nodeId: "a", frameIndex: 0, label: "A", text: "x" })).toBe(false); });
    expect(result.current.comments).toEqual([]);
    expect(result.current.error).toContain("没能钉上这条批注");
  });

  it("R8 写在本机的旧批注：上传一次后从本机删掉；已交给 AI 的不搬；坏数据读成空", async () => {
    const server = commentServer();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => server.handle(path, opts));
    window.localStorage.setItem("wsx-design-comments:p1", JSON.stringify([
      { id: "old1", nodeId: "a", frameIndex: 0, label: "A", text: "旧的一条", resolved: false },
      { id: "old2", nodeId: "b", frameIndex: 0, label: "B", text: "交过了", resolved: true },
    ]));
    const { result } = renderHook(() => useDesignComments("p1"));
    await waitFor(() => expect(result.current.comments.map((x) => x.text)).toEqual(["旧的一条"]));
    expect(window.localStorage.getItem("wsx-design-comments:p1")).toBeNull();
    window.localStorage.setItem("wsx-design-comments:p3", "{not json");
    expect(loadLegacyComments("p3")).toEqual([]);
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
    const server = commentServer();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: { text: string; focusNodeId?: string } }) => {
      if (path === "/pm-designs") return { items: [project] };
      const commentReply = server.handle(path, opts as never);
      if (commentReply !== undefined) return commentReply;
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
    await waitFor(() => expect(screen.getAllByTestId("design-comment-item")).toHaveLength(1));
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

describe("深度 S3 批注讨论（#3988）", () => {
  const base = { frame: 0, sending: false, onRemove: vi.fn(), onSend: vi.fn(), onClearResolved: vi.fn(), onFocus: vi.fn() };

  it("回复：点「回复」出输入框，回车发出；存上了才清空收起，没存上留着字", async () => {
    const onReply = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<CommentList {...base} comments={[c({ replies: [{ id: "r1", text: "同意", authorId: "u2", authorName: "同事", createdAt: "2026-09-24T00:00:00.000Z" }] })]} onReply={onReply} onSetResolved={vi.fn()} />);
    expect(screen.getByTestId("design-comment-item").textContent).toContain("同事：同意");
    fireEvent.click(screen.getByTestId("design-comment-reply"));
    const input = screen.getByTestId("design-comment-reply-input");
    fireEvent.change(input, { target: { value: "用主色" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onReply).toHaveBeenCalledWith("c1", "用主色"));
    expect((screen.getByTestId("design-comment-reply-input") as HTMLInputElement).value).toBe("用主色");
    fireEvent.click(screen.getByTestId("design-comment-reply-save"));
    await waitFor(() => expect(screen.queryByTestId("design-comment-reply-input")).toBeNull());
  });

  it("未解决的给「标记解决」，已解决的给「重新打开」；已解决的排在后面、不占编号", () => {
    const onSetResolved = vi.fn();
    render(<CommentList {...base} comments={[c({ id: "a", resolved: true, text: "旧的" }), c({ id: "b", text: "新的" })]} onReply={vi.fn()} onSetResolved={onSetResolved} />);
    const items = screen.getAllByTestId("design-comment-item");
    expect(items.map((i) => i.getAttribute("data-resolved"))).toEqual([null, "true"]);
    fireEvent.click(within(items[0]!).getByTestId("design-comment-resolve"));
    fireEvent.click(within(items[1]!).getByTestId("design-comment-reopen"));
    expect(onSetResolved.mock.calls).toEqual([["b", true], ["a", false]]);
  });
});
