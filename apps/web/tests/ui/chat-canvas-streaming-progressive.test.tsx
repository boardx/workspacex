/**
 * 画布围栏边生成边显示（#3866 R4）。
 *
 * 改之前：`closed === false` 时校验 effect 整个提前返回，状态机停在 validating，
 * 于是本地版 4B 写一张画布的三十多秒里，用户看到的自始至终是「画布内容生成中…」
 * 一行字，然后整张画布一次蹦出来。
 *
 * 改之后：半截内容一旦已经能解析（有「模板:」行 + 至少一个「## 分区」），就先画出来，
 * 之后按取样节奏长。**判错的时机一字未改**：未闭合时永远不进错误分支（issue #2298）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { __resetFenceTemplateCache } from "@/lib/canvas/fence-template-resolver";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse: vi.fn().mockResolvedValue(true), render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }) },
}));
const listCanvasTemplates = vi.fn();
vi.mock("@/lib/live-canvas", () => ({ listCanvasTemplates: (...a: unknown[]) => listCanvasTemplates(...a) }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));

beforeEach(() => {
  __resetFenceTemplateCache();
  listCanvasTemplates.mockReset();
  listCanvasTemplates.mockResolvedValue({ templates: [] });   // 内置 key，走原生几何
});

/** 流式中途的半截围栏：没有收尾的 ```。 */
const PARTIAL_RENDERABLE = ["```canvas", "模板: persona", "姓名: 林可", "## 用户描述", "- 项目型采购"].join("\n");
const PARTIAL_TOO_EARLY = ["```canvas", "模板: per"].join("\n");
const CLOSED = [...PARTIAL_RENDERABLE.split("\n"), "```"].join("\n");

describe("流式画布：能解析就先画", () => {
  it("半截内容已含模板行与一个分区 → 已经开始渲染，不是干等", async () => {
    render(<MarkdownMessage text={PARTIAL_RENDERABLE} />);
    await waitFor(() => expect(screen.getByTestId("chat-canvas-fabric-surface")).toBeTruthy());
  });

  it("刚开头、还解析不出来 → 停在生成中，且**不**判成格式错误", async () => {
    render(<MarkdownMessage text={PARTIAL_TOO_EARLY} />);
    await waitFor(() => expect(screen.getByTestId("chat-canvas-loading").textContent).toContain("画布内容生成中"));
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
    expect(screen.queryByTestId("chat-canvas-fabric-surface")).toBeNull();
  });

  it("闭合后照旧渲染（终态没被这次改动动过）", async () => {
    render(<MarkdownMessage text={CLOSED} />);
    await waitFor(() => expect(screen.getByTestId("chat-canvas-fabric-surface")).toBeTruthy());
  });

  it("闭合之后内容确实坏掉了，才判格式错误", async () => {
    render(<MarkdownMessage text={["```canvas", "这里根本没有模板行", "```"].join("\n")} />);
    await waitFor(() => expect(screen.getByTestId("chat-canvas-error")).toBeTruthy());
  });
});
