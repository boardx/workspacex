/**
 * issue #4244 —— 实时聊天界面的助手消息引用：`getThread` 的 `messages[].citations`
 * 经 `ThreadCitationsProvider` → `PersistedMessageCitationScope` 渲成可点 `[n]` 标记与
 * 紧凑引用列表；点开调 `openCitation(citationId)`（E3 `citation_opened`）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const openCitation = vi.fn();
vi.mock("@/lib/live-chat", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-chat")>()),
  openCitation: (id: string) => openCitation(id),
}));

import { MarkdownMessage } from "@/components/chat/markdown-message";
import {
  CitationList,
  PersistedMessageCitationScope,
  ThreadCitationsProvider,
} from "@/components/chat/message-citations";

const citation = (citationId: string, index: number, page: number) => ({
  citationId,
  index,
  sourceFullName: `来源文档 ${index}`,
  anchor: { kind: "page" as const, page, range: null, messageId: null },
});

function Live({ text, citations }: { text: string; citations: ReturnType<typeof citation>[] }) {
  return (
    <ThreadCitationsProvider messages={[{ id: "m-1", citations }]}>
      <PersistedMessageCitationScope messageId="m-1">
        <MarkdownMessage text={text} />
        <CitationList />
      </PersistedMessageCitationScope>
    </ThreadCitationsProvider>
  );
}

afterEach(() => {
  cleanup();
  openCitation.mockReset();
});

describe("实时消息引用（issue #4244）", () => {
  it("有引用：正文 [n] 渲成标记，消息下方渲染引用列表", () => {
    render(<Live text="结论 A [1]，结论 B [2]。" citations={[citation("c-1", 1, 3), citation("c-2", 2, 7)]} />);
    const markers = screen.getAllByTestId("chat-citation-marker");
    expect(markers.map((m) => m.textContent)).toEqual(["[1]", "[2]"]);
    expect(screen.getByTestId("chat-citations")).toBeTruthy();
    expect(screen.getAllByTestId("chat-citation-row")).toHaveLength(2);
    expect(screen.getByTestId("chat-citations").textContent).toContain("第 3 页");
  });

  it("点正文标记：调 openCitation(对应 citationId) 并展开该引用", () => {
    render(<Live text="见 [2]" citations={[citation("c-1", 1, 3), citation("c-2", 2, 7)]} />);
    fireEvent.click(screen.getByTestId("chat-citation-marker"));
    expect(openCitation).toHaveBeenCalledTimes(1);
    expect(openCitation).toHaveBeenCalledWith("c-2");
    expect(screen.getByTestId("chat-citation-anchor").textContent).toContain("第 7 页");
    // 已展开再点同一标记不重复上报
    fireEvent.click(screen.getByTestId("chat-citation-marker"));
    expect(openCitation).toHaveBeenCalledTimes(1);
  });

  it("点列表行：调 openCitation(对应 citationId)", () => {
    render(<Live text="正文 [1]" citations={[citation("c-1", 1, 3)]} />);
    fireEvent.click(screen.getByTestId("chat-citation-row"));
    expect(openCitation).toHaveBeenCalledWith("c-1");
  });

  it("无引用：不渲染列表、[n] 保持纯文本", () => {
    render(<Live text="没有引用 [1]" citations={[]} />);
    expect(screen.queryByTestId("chat-citations")).toBeNull();
    expect(screen.queryByTestId("chat-citation-marker")).toBeNull();
    expect(screen.getByTestId("chat-ai-markdown").textContent).toContain("没有引用 [1]");
  });

  it("没有对应引用的 [n] 保持纯文本；代码里的 [1] 不变", () => {
    render(<Live text={"A [1] B [5] `x[1]`"} citations={[citation("c-1", 1, 3)]} />);
    const markers = screen.getAllByTestId("chat-citation-marker");
    expect(markers).toHaveLength(1);
    expect(markers[0]!.textContent).toBe("[1]");
    const body = screen.getByTestId("chat-ai-markdown");
    expect(body.textContent).toContain("B [5]");
    expect(body.querySelector("code")?.textContent).toBe("x[1]");
  });

  it("Provider 外（或 id 未知）：渲染与之前相同，无列表", () => {
    render(
      <PersistedMessageCitationScope messageId="unknown">
        <MarkdownMessage text="文本 [1]" />
        <CitationList />
      </PersistedMessageCitationScope>,
    );
    expect(screen.queryByTestId("chat-citations")).toBeNull();
    expect(screen.queryByTestId("chat-citation-marker")).toBeNull();
  });
});
